const APT_DISTROS = ['debian', 'ubuntu', 'linuxmint', 'pop', 'elementary', 'zorin'];
const DNF_DISTROS = ['fedora', 'rhel', 'centos', 'rocky', 'almalinux'];
const PACMAN_DISTROS = ['arch', 'manjaro', 'endeavouros'];
const ZYPPER_DISTROS = ['opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'suse'];

export function getJavaInstallInstructions(platform, { distroId = '', distroLike = '' } = {}) {
  if (platform === 'win32') {
    return {
      label: 'Windows · winget',
      command: 'winget install --id EclipseAdoptium.Temurin.17.JRE -e',
    };
  }
  if (platform === 'darwin') {
    return {
      label: 'macOS · Homebrew',
      command: 'brew install --cask temurin@17',
    };
  }
  if (platform !== 'linux') {
    return { label: 'Java 17+', command: '' };
  }

  const ids = `${distroId} ${distroLike}`.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (ids.some((id) => APT_DISTROS.includes(id))) {
    return {
      label: 'Debian · Ubuntu · Linux Mint',
      command: 'sudo apt update && sudo apt install -y openjdk-17-jre-headless',
    };
  }
  if (ids.some((id) => DNF_DISTROS.includes(id))) {
    return {
      label: 'Fedora · RHEL',
      command: 'sudo dnf install java-17-openjdk',
    };
  }
  if (ids.some((id) => PACMAN_DISTROS.includes(id))) {
    return {
      label: 'Arch Linux',
      command: 'sudo pacman -S jre17-openjdk',
    };
  }
  if (ids.some((id) => ZYPPER_DISTROS.includes(id))) {
    return {
      label: 'openSUSE',
      command: 'sudo zypper install java-17-openjdk',
    };
  }
  return { label: 'Linux', command: '' };
}
