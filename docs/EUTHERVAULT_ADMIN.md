# EutherVault adminrapport

`/backup-admin` är en adminskyddad rapport för EutherHosts krypterade
användarbackuper. Den återanvänder befintlig session, adminroll, CSRF-skydd och
audit-logg. Rapporten verifierar SHA-256 och age-header för tre datamängder:
konton, kritiskt serverstate och användarmedia. Kontosnapshots kan laddas ned
som redan krypterade `.age`-filer.

Kritiskt state arkiveras dagligen utan loggar, OpenRA-runtime och stora
mediafiler. Media exporteras separat som innehållsadresserade, krypterade objekt;
oförändrade filer krypteras bara en gång och varje körning får ett krypterat
manifest. Servern behåller state i 30 dagar och mediamanifest i 90 dagar medan
mediaobjekt bevaras för återställbarhet.

Gränssnittet erbjuder avsiktligt ingen radering och har aldrig tillgång till den
privata återställningsnyckeln. En manuell backup köas som en fil och plockas upp
av en root-ägd systemd-path; EutherHost får inga sudo-rättigheter.

Installera privilegiegränsen på servern:

```bash
sudo install -d -m 0750 -o nichlas -g nichlas /home/nichlas/EutherOxide/.euther-host/backup-requests
sudo install -m 0644 deploy/eutherhost-backup-request.service /etc/systemd/system/
sudo install -m 0644 deploy/eutherhost-backup-request.path /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eutherhost-backup-request.path
sudo systemctl enable --now eutherhost-state-backup.timer eutherhost-media-backup.timer
```

Offhost-spegeln på `192.168.32.88` hämtar alla tre datamängderna, fortsätter
vara pull-baserad och använder ingen delete-synk. Den privata nyckeln och äldre
spegelkopior exponeras inte av portalen.
