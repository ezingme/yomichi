# Ichiran custom data

Copied unchanged from Ichiran `data/sources` at commit
`002a695b3c86a9524e49354f04b7a915beb71270`
(https://github.com/tshatrov/ichiran, Copyright (c) 2014 Timofei Shatrov,
MIT licence, see `licenses/ichiran-MIT.txt`).

- `extra.xml` — additional entries maintained by Ichiran (e.g. せず, お掛け,
  suffix entries 900000 たそう and 900001 もいい).
- `jichitai.csv` — Japanese local government codes, names and readings
  (prefectures and municipalities), as distributed by Ichiran. The underlying
  code list is published by the Ministry of Internal Affairs and Communications
  (総務省 全国地方公共団体コード).
- `gyoseiku.csv` — wards of designated cities, as distributed by Ichiran.

The Ichiran-model builder (`src/ichiran-build`) loads these exactly as
Ichiran's `load-custom-data` does. Dictionary data (JMdict, KANJIDIC2) is not
included and remains under EDRDG terms.
