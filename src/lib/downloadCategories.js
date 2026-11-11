// ---------------------------------------------------------------------------
// Classement automatique des téléchargements par type — LOGIQUE PURE.
//
// Un gestionnaire de téléchargement range ses fichiers : les images avec les
// images, les archives avec les archives. Orbit fait de même quand l'option est
// activée (Réglages → Téléchargements → « Classer par type »), sinon tout va
// dans le dossier choisi.
//
// Les noms de dossiers sont fixes et volontairement simples : l'utilisateur les
// retrouve d'une langue à l'autre, et rien ne casse si l'interface change.
// ---------------------------------------------------------------------------

import { extensionOf } from './fileTypes.js';

export const DOWNLOAD_CATEGORIES = {
  images: 'Images',
  video: 'Vidéos',
  audio: 'Audio',
  documents: 'Documents',
  archives: 'Archives',
  programs: 'Programmes',
  other: 'Autres',
};

const EXTENSIONS = {
  images: 'png jpg jpeg gif webp bmp ico avif svg tif tiff heic heif',
  video: 'mp4 m4v mkv webm mov avi mpg mpeg wmv flv ogv 3gp ts m2ts',
  audio: 'mp3 wav ogg oga opus m4a flac aac weba aiff wma mid midi',
  documents:
    'pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md markdown csv tsv ' +
    'epub mobi djvu pub pages numbers key',
  archives: 'zip rar 7z tar gz tgz bz2 xz zst lz lzma cab iso dmg',
  programs: 'exe msi msix deb rpm apk aab appimage pkg snap flatpak jar crx xpi bin',
};

const BY_EXTENSION = new Map();
for (const [category, list] of Object.entries(EXTENSIONS)) {
  for (const ext of list.split(' ')) if (ext) BY_EXTENSION.set(ext, DOWNLOAD_CATEGORIES[category]);
}

// Dossier de classement pour un nom de fichier. Tout ce qui n'est pas reconnu
// va dans « Autres » : on ne devine jamais un type d'après le contenu.
export function downloadCategory(filename) {
  const ext = extensionOf(filename);
  return BY_EXTENSION.get(ext) || DOWNLOAD_CATEGORIES.other;
}
