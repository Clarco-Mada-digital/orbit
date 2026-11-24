import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMdnsServices, qrPairingPayload, parseWlanIp, parseAdbDevices, MDNS_PAIRING, MDNS_CONNECT } from '../src/lib/phone.js';

test('annonces mDNS des téléphones (formats adb 34 et 36)', () => {
  const out = `List of discovered mdns services
adb-R58M12AB-xYz9	_adb-tls-connect._tcp	192.168.1.42:37143
orbit-k2j4h5	_adb-tls-pairing._tcp.	192.168.1.42:40121
adb-R58M12AB-xYz9 _adb._tcp 192.168.1.42:5555
bruit sans adresse`;
  const list = parseMdnsServices(out);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: 'adb-R58M12AB-xYz9', type: MDNS_CONNECT, host: '192.168.1.42', port: 37143, address: '192.168.1.42:37143' });
  assert.equal(list[1].type, MDNS_PAIRING);
  assert.equal(list[1].name, 'orbit-k2j4h5');
});

test('QR code d’appairage au format Android Studio', () => {
  assert.equal(qrPairingPayload('orbit-k2j4h5', 'Ab12Cd34Ef'), 'WIFI:T:ADB;S:orbit-k2j4h5;P:Ab12Cd34Ef;;');
  assert.throws(() => qrPairingPayload('a;b', 'x'), /invalide/);
});

test('adresse Wi-Fi du téléphone et appareils connectés par mDNS', () => {
  assert.equal(parseWlanIp('3: wlan0: <BROADCAST,MULTICAST,UP>\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0'), '192.168.1.42');
  assert.equal(parseWlanIp('rien'), null);
  const devs = parseAdbDevices('List of devices attached\nadb-R58M12AB-xYz9._adb-tls-connect._tcp\tdevice\nR58M12AB\tdevice\n');
  assert.deepEqual(devs.map((d) => d.wireless), [true, false]);
});

test('adresse Wi-Fi : jamais les données mobiles, le point d’accès en secours', () => {
  const out = `1: lo: <LOOPBACK,UP>\n    inet 127.0.0.1/8 scope host lo\n2: rmnet_data0: <UP>\n    inet 10.12.0.5/30 scope global rmnet_data0\n3: wlan0: <UP>\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0`;
  assert.equal(parseWlanIp(out), '192.168.1.42');
  assert.equal(parseWlanIp(`5: ap0: <UP>\n    inet 192.168.43.1/24 scope global ap0\n2: rmnet_data0: <UP>\n    inet 10.1.1.1/30 scope global rmnet_data0`), '192.168.43.1');
  assert.equal(parseWlanIp(`2: rmnet_data0: <UP>\n    inet 10.1.1.1/30 scope global rmnet_data0`), null);
});

test('téléphones mémorisés : même nom mDNS ou même hôte = même appareil', async () => {
  const { rememberWirelessDevice, normalizePhoneSettings, mdnsBaseName } = await import('../src/lib/phone.js');
  let list = rememberWirelessDevice([], { name: 'adb-R58-x', address: '192.168.1.42:37143', label: 'Pixel 8', at: 1 });
  list = rememberWirelessDevice(list, { address: '192.168.1.50:5555', at: 2 });
  list = rememberWirelessDevice(list, { name: 'adb-R58-x', address: '192.168.1.42:40999', at: 3 });
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { name: 'adb-R58-x', address: '192.168.1.42:40999', label: 'Pixel 8', at: 3 });
  assert.equal(mdnsBaseName('adb-R58-x._adb-tls-connect._tcp'), 'adb-R58-x');
  const s = normalizePhoneSettings({ wirelessDevices: [{ address: 'x;rm -rf' }, { name: 'ok-1' }] });
  assert.deepEqual(s.wirelessDevices.map((d) => d.name), ['ok-1']);
  assert.equal(s.wirelessAutoReconnect, true);
});

test('mode réseau « adb tcpip » annoncé en _adb._tcp', async () => {
  const { MDNS_LEGACY, mdnsBaseName } = await import('../src/lib/phone.js');
  const [svc] = parseMdnsServices('List of discovered mdns services\nadb-RZ8N31CT5DD\t_adb._tcp\t192.168.2.10:5555\n');
  assert.equal(svc.type, MDNS_LEGACY);
  assert.equal(svc.address, '192.168.2.10:5555');
  assert.equal(mdnsBaseName('adb-RZ8N31CT5DD._adb._tcp'), 'adb-RZ8N31CT5DD');
});
