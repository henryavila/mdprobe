import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

export async function openBrowser(url) {
  const isWSL = process.platform === 'linux'
    ? await readFile('/proc/version', 'utf-8').then(v => /microsoft/i.test(v)).catch(() => false)
    : false

  let cmd, args
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', url]
  } else if (isWSL) {
    cmd = '/mnt/c/Windows/System32/cmd.exe'
    args = ['/c', 'start', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }

  return new Promise((resolve) => {
    execFile(cmd, args, { stdio: 'ignore' }, () => resolve())
  })
}
