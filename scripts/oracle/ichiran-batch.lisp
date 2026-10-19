;;; Batch capture of live Ichiran output for Yomichi comparison.
;;; Reads one JSON object per line ({"id": "...", "text": "...", "limit": 5})
;;; from stdin and writes one JSON object per line containing, for the
;;; normalized input split by basic-split, the dict-segment paths serialized
;;; with word-info-json (upstream structure), and optionally romanize* output.
;;;   sbcl --core ichiran.core --non-interactive --load ichiran-batch.lisp < in.jsonl
(in-package :ichiran/dict)

(defmethod jsown:to-json ((word-info word-info))
  (jsown:to-json (word-info-gloss-json word-info)))

(defun capture (text limit full)
  (let ((input (ichiran/characters:normalize text)))
    (jsown:new-js
      ("normalized" input)
      ("chunks"
       (loop for (split-type . split-text) in (ichiran/characters:basic-split input)
             collect
             (if (eql split-type :word)
                 (jsown:new-js
                   ("type" "word")
                   ("text" split-text)
                   ("paths" (loop for (wis . score) in (dict-segment split-text :limit limit)
                                  collect (jsown:new-js
                                            ("score" score)
                                            ("words" (mapcar #'word-info-json wis))))))
                 (jsown:new-js ("type" "misc") ("text" split-text)))))
      ("full" (if full
                  (jsown:parse (jsown:to-json (ichiran:romanize* text :limit 1)))
                  :null))
      ("info" (if full
                  (multiple-value-bind (rom info) (ichiran:romanize text :with-info t)
                    (jsown:new-js
                      ("text" rom)
                      ("words" (loop for (r . str) in info collect (list r str)))))
                  :null)))))

(defun suffix-snapshot ()
  "Initial word-conjugations of the shared suffix words. Upstream mutates them
   during analysis, so outputs depend on earlier inputs; restoring this state
   before every input makes each capture equal to a fresh process."
  (let (acc)
    (maphash (lambda (k v)
               (declare (ignore k))
               (dolist (item (if (consp (car v)) v (list v)))
                 (when (second item)
                   (push (cons (second item) (word-conjugations (second item))) acc))))
             *suffix-cache*)
    acc))

(defun main-loop ()
  (ichiran/conn::load-connection-from-env)
  (with-connection *connection*
    (init-suffixes t)
    (loop with snapshot = (suffix-snapshot)
          for line = (read-line *standard-input* nil nil)
          while line
          unless (zerop (length (string-trim " " line)))
          do (loop for (kf . conj) in snapshot do (setf (word-conjugations kf) conj))
             (let* ((obj (jsown:parse line))
                    (id (jsown:val obj "id"))
                    (text (jsown:val obj "text"))
                    (limit (or (ignore-errors (jsown:val obj "limit")) 5))
                    (full (ignore-errors (jsown:val obj "full")))
                    (result (handler-case (capture text limit full)
                              (error (e) (jsown:new-js ("error" (princ-to-string e)))))))
               (setf (jsown:val result "id") id
                     (jsown:val result "text") text)
               (write-string (jsown:to-json result))
               (terpri)
               (finish-output)))))

(main-loop)
