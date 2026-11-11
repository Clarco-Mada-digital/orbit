// ---------------------------------------------------------------------------
// Détection du type de champ pour le remplissage 🎲 (« fake data »).
//
// Le bogue qui a motivé ces tests : un champ dont le seul indice est son
// <label> (« Nom », « Prénom ») recevait du Lorem Ipsum, parce que la
// détection ne lisait que name/id/placeholder/aria-label. Le bloc partagé lit
// désormais le libellé — et ces tests fixent les pièges de « nom » et de
// « name » (nom d'utilisateur, nom de société, nom du produit…).
//
// Le bloc vit en DEUX exemplaires — le preload natif et le content script de
// l'extension — parce qu'aucun des deux ne peut importer de module local. On
// vérifie donc aussi qu'ils sont IDENTIQUES : une divergence voudrait dire que
// le 🎲 ne devine pas la même chose selon qu'Orbit remplit lui-même ou que
// l'extension du ZIP est installée.
//
// Aucune dépendance : le bloc est extrait puis exécuté dans un `vm`, avec des
// champs simulés (voir la règle du projet, les tests tournent sans
// `node_modules`).
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '// --- début bloc fake data partagé ---';
const END = '// --- fin bloc fake data partagé ---';

function extractBlock(file) {
  const source = fs.readFileSync(file, 'utf8');
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  assert.ok(from >= 0 && to > from, `marqueurs du bloc absents de ${path.basename(file)}`);
  // Les deux copies ne vivent pas au même niveau d'indentation (une est dans
  // une IIFE) : on compare le code, pas la mise en page.
  return source
    .slice(from, to + END.length)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

function dedent(block) {
  return block
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n');
}

const PRELOAD = path.join(ROOT, 'electron', 'credentials-preload.cjs');
const CONTENT = path.join(
  ROOT,
  'electron',
  'extensions',
  'fake-data-filler-orbit',
  'content.js'
);

const preloadBlock = extractBlock(PRELOAD);

const api = vm.runInNewContext(
  `${preloadBlock}\n;({ fakeNorm, fakeFieldHint, detectFieldKind, acceptsFakeImage,` +
    ` fakeCustomValue, fakeCustomValues, fakeAvatarUrl, fakePictureUrl, fakeInitials });`
);
const {
  fakeNorm,
  detectFieldKind,
  acceptsFakeImage,
  fakeCustomValue,
  fakeCustomValues,
  fakeAvatarUrl,
  fakePictureUrl,
  fakeInitials,
} = api;

// Le content script de l'extension n'est pas suivi par git (seule l'archive
// publiée l'est) : s'il n'est pas là, on ne peut pas comparer, mais les règles
// restent testées.
test('bloc partagé : la copie de l’extension est identique à celle du preload', (t) => {
  if (!fs.existsSync(CONTENT)) {
    t.skip('source de l’extension absente de ce dépôt');
    return;
  }
  assert.equal(
    dedent(extractBlock(CONTENT)),
    preloadBlock,
    'les deux copies du bloc ont divergé : réinjectez la même version dans les deux fichiers'
  );
});

// Champ simulé : seulement ce que le bloc lit réellement.
function makeField({
  tagName = 'input',
  type = 'text',
  name = '',
  id = '',
  placeholder = '',
  ariaLabel = '',
  title = '',
  autocomplete = '',
  accept = '',
  label = '',
  siblingLabel = '',
  formControlName = '',
  isContentEditable = false,
} = {}) {
  const attrs = {
    type,
    placeholder,
    'aria-label': ariaLabel,
    title,
    autocomplete,
    accept,
    formcontrolname: formControlName,
  };
  return {
    tagName: tagName.toUpperCase(),
    type,
    name,
    id,
    autocomplete,
    isContentEditable,
    labels: label ? [{ textContent: label }] : [],
    getAttribute: (key) => attrs[key] || null,
    closest: () => null,
    previousElementSibling: siblingLabel
      ? { tagName: 'LABEL', textContent: siblingLabel }
      : null,
    parentElement: null,
  };
}

const kindOf = (field) => detectFieldKind(makeField(field));

test('fakeNorm : accents, camelCase et séparateurs donnent des mots', () => {
  assert.equal(fakeNorm('Prénom'), 'prenom');
  assert.equal(fakeNorm('firstName'), 'first name');
  assert.equal(fakeNorm('user_last-name'), 'user last name');
  assert.equal(fakeNorm('Nom de famille *'), 'nom de famille');
  assert.equal(fakeNorm(null), '');
});

test('le libellé seul suffit : le champ « Nom » n’est plus du texte libre', () => {
  // LE cas signalé : name/id ne disent rien, tout est dans le <label>.
  assert.equal(kindOf({ name: 'field_12', label: 'Nom' }), 'lastName');
  assert.equal(kindOf({ name: 'field_13', label: 'Prénom' }), 'firstName');
  assert.equal(kindOf({ name: 'input-2', label: 'Nom complet' }), 'fullName');
  // Libellé posé en frère, sans attribut `for`.
  assert.equal(kindOf({ name: 'f3', siblingLabel: 'Ville' }), 'city');
  // Sans aucun indice, on ne devine pas : du texte.
  assert.equal(kindOf({ name: 'field_14' }), 'text');
});

test('« nom » et « name » : les pièges sont levés avant les règles larges', () => {
  assert.equal(kindOf({ label: "Nom d'utilisateur" }), 'username');
  assert.equal(kindOf({ label: 'Nom de famille' }), 'lastName');
  assert.equal(kindOf({ label: "Nom de l'entreprise" }), 'company');
  assert.equal(kindOf({ label: 'Raison sociale' }), 'company');
  assert.equal(kindOf({ label: 'Nom et prénom' }), 'fullName');
  assert.equal(kindOf({ name: 'companyName' }), 'company');
  assert.equal(kindOf({ name: 'lastName' }), 'lastName');
  assert.equal(kindOf({ name: 'firstName' }), 'firstName');
  // Un intitulé, pas une personne.
  assert.equal(kindOf({ label: 'Nom du produit' }), 'subject');
  // « name » seul, en anglais, est un nom complet.
  assert.equal(kindOf({ name: 'name' }), 'fullName');
});

test('autocomplete fait foi, même avec des préfixes', () => {
  assert.equal(kindOf({ autocomplete: 'shipping postal-code' }), 'zip');
  assert.equal(kindOf({ autocomplete: 'section-a billing address-level2' }), 'city');
  assert.equal(kindOf({ autocomplete: 'given-name' }), 'firstName');
  assert.equal(kindOf({ autocomplete: 'family-name' }), 'lastName');
  assert.equal(kindOf({ autocomplete: 'organization-title' }), 'jobTitle');
  assert.equal(kindOf({ autocomplete: 'cc-number' }), 'creditCard');
  // `on` / `off` ne déclarent aucun type : on retombe sur les libellés.
  assert.equal(kindOf({ autocomplete: 'off', label: 'Ville' }), 'city');
});

test('le type HTML borne la devinette', () => {
  assert.equal(kindOf({ type: 'password', label: 'Nom' }), 'password');
  assert.equal(kindOf({ type: 'email', label: 'Nom' }), 'email');
  assert.equal(kindOf({ type: 'tel' }), 'phone');
  assert.equal(kindOf({ type: 'checkbox' }), 'boolean');
  assert.equal(kindOf({ type: 'color' }), 'color');
  // Une photo de profil demandée dans un champ URL n'est pas un site web.
  assert.equal(kindOf({ type: 'url', name: 'avatarUrl' }), 'avatar');
  assert.equal(kindOf({ type: 'url', label: 'Site web' }), 'url');
  // Un champ numérique ne peut pas recevoir une adresse : on reste sur un nombre.
  assert.equal(kindOf({ type: 'number', label: 'Adresse' }), 'number');
  assert.equal(kindOf({ type: 'number', label: 'Âge' }), 'age');
  // Une date de naissance doit tomber dans le passé.
  assert.equal(kindOf({ type: 'date', label: 'Date de naissance' }), 'birthdate');
  assert.equal(kindOf({ type: 'date', label: 'Date de début' }), 'date');
  // Une zone de texte sans indice reste du Lorem Ipsum.
  assert.equal(kindOf({ tagName: 'textarea' }), 'lorem');
  assert.equal(kindOf({ tagName: 'textarea', label: 'Message' }), 'lorem');
  assert.equal(kindOf({ tagName: 'select' }), 'choice');
});

test('autres types reconnus : identité, paiement, images', () => {
  assert.equal(kindOf({ label: 'Photo de profil' }), 'avatar');
  assert.equal(kindOf({ label: 'Image de couverture' }), 'image');
  assert.equal(kindOf({ label: 'Sexe' }), 'gender');
  assert.equal(kindOf({ label: 'IBAN' }), 'iban');
  assert.equal(kindOf({ label: 'Cryptogramme' }), 'cardCvc');
  assert.equal(kindOf({ label: 'MM/AA' }), 'cardExpiry');
  assert.equal(kindOf({ label: 'Code postal' }), 'zip');
  assert.equal(kindOf({ label: 'Pays' }), 'country');
  assert.equal(kindOf({ label: 'Fonction' }), 'jobTitle');
  assert.equal(kindOf({ placeholder: 'votre adresse e-mail' }), 'email');
  assert.equal(kindOf({ formControlName: 'telephone' }), 'phone');
});

test('acceptsFakeImage : un champ fichier ne reçoit une image que s’il en veut', () => {
  assert.equal(acceptsFakeImage(makeField({ type: 'file', accept: 'image/*' })), true);
  assert.equal(acceptsFakeImage(makeField({ type: 'file', accept: '.png,.webp' })), true);
  // « Déposez votre CV » ne doit pas recevoir un PNG.
  assert.equal(acceptsFakeImage(makeField({ type: 'file', accept: '.pdf' })), false);
  assert.equal(acceptsFakeImage(makeField({ type: 'file', label: 'Votre CV' })), false);
  // Sans `accept`, le libellé décide.
  assert.equal(acceptsFakeImage(makeField({ type: 'file', label: 'Votre avatar' })), true);
  assert.equal(acceptsFakeImage(makeField({ type: 'text', label: 'Avatar' })), false);
  assert.equal(kindOf({ type: 'file', accept: 'image/png' }), 'imageFile');
  assert.equal(kindOf({ type: 'file', accept: '.pdf' }), 'file');
});

test('valeurs personnalisées : liste piochée, valeur unique, retour aux intégrées', () => {
  const config = {
    lists: { city: ['Lyon', 'Nantes'], country: 'Belgique\n  Suisse  \n\n' },
    firstName: 'Camille',
    text: 'Deux lignes\nde texte libre',
  };

  // Une liste : la valeur sort de la liste, et seulement de là.
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(fakeCustomValue(config, 'city'));
  assert.deepEqual([...seen].sort(), ['Lyon', 'Nantes']);

  // Une liste saisie en texte : une valeur par ligne, lignes vides ignorées.
  // (Array.from : le tableau vient du `vm`, donc d'un autre realm.)
  assert.deepEqual(Array.from(fakeCustomValues(config, 'country')), ['Belgique', 'Suisse']);

  // Ancien format (valeur unique) : toujours lu, et JAMAIS découpé en lignes.
  assert.equal(fakeCustomValue(config, 'firstName'), 'Camille');
  assert.equal(fakeCustomValue(config, 'text'), 'Deux lignes\nde texte libre');

  // Rien pour ce type : au générateur intégré de décider.
  assert.equal(fakeCustomValue(config, 'company'), null);
  assert.equal(fakeCustomValue({}, 'city'), null);
  assert.equal(fakeCustomValue(null, 'city'), null);

  // « Valeurs intégrées » : les listes restent enregistrées mais sont ignorées.
  assert.equal(fakeCustomValue({ ...config, source: 'builtin' }, 'city'), null);
  assert.equal(fakeCustomValue({ ...config, source: 'builtin' }, 'firstName'), null);

  // Une liste de valeurs vides ne compte pas pour une personnalisation.
  assert.equal(fakeCustomValue({ lists: { city: ['', '  '] } }, 'city'), null);
});

// Une seule source d'images donnait toujours la même sorte de résultat. Ces
// tests fixent ce qu'on attend : plusieurs familles tirées au hasard, des URL
// bien formées, et SURTOUT une image qui s'affiche quand les photos externes
// sont coupées (l'ancienne adresse d'exemple ne montrait rien).
const hostsOf = (make, calls = 400) => {
  const hosts = new Set();
  for (let i = 0; i < calls; i += 1) hosts.add(new URL(make()).host);
  return hosts;
};

test('photo de profil : plusieurs familles d’images, pas une seule', () => {
  const hosts = hostsOf(() => fakeAvatarUrl('Camille', 'Martin', true));
  // Initiales, avatar dessiné, portraits de stock, visage généré, robot.
  for (const host of [
    'ui-avatars.com',
    'api.dicebear.com',
    'randomuser.me',
    'i.pravatar.cc',
    'thispersondoesnotexist.com',
    'robohash.org',
  ]) {
    assert.ok(hosts.has(host), `${host} n’est jamais tiré`);
  }

  // Les initiales suivent le nom réellement rempli dans le formulaire.
  assert.equal(fakeInitials('Camille', 'Martin'), 'CM');
  assert.equal(fakeInitials('', ''), 'OT');
  const initials = [];
  for (let i = 0; i < 400; i += 1) {
    const url = fakeAvatarUrl('Camille', 'Martin', true);
    if (url.startsWith('https://ui-avatars.com')) initials.push(url);
  }
  assert.ok(initials.length, 'aucune URL d’initiales tirée');
  assert.ok(
    initials.every((url) => url.includes('name=Camille%20Martin')),
    'les initiales ne reprennent pas le nom rempli'
  );

  // Deux remplissages de suite ne doivent pas donner la même adresse.
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) seen.add(fakeAvatarUrl('Camille', 'Martin', true));
  assert.ok(seen.size > 10, 'les adresses se répètent trop');
});

test('image quelconque : plusieurs familles aussi', () => {
  const hosts = hostsOf(() => fakePictureUrl(true));
  for (const host of ['picsum.photos', 'placehold.co', 'placecats.com', 'placedog.net']) {
    assert.ok(hosts.has(host), `${host} n’est jamais tiré`);
  }
});

test('photos coupées : une image dessinée sur place, qui s’affiche hors ligne', () => {
  const avatar = fakeAvatarUrl('Camille', 'Martin', false);
  const picture = fakePictureUrl(false);
  for (const url of [avatar, picture]) {
    assert.ok(url.startsWith('data:image/svg+xml,'), 'ce n’est pas une image locale');
    // Aucun service n'est appelé (le seul « http » restant est l'espace de
    // noms XML du SVG, qui n'est pas une requête).
    assert.match(decodeURIComponent(url), /^data:image\/svg\+xml,<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(url, /randomuser|picsum|dicebear|ui-avatars|pravatar|robohash|example\.com/);
  }
  // Les initiales de la personne remplie sont bien dessinées.
  assert.ok(decodeURIComponent(avatar).includes('>CM<'));
});
