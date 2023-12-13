import * as childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import split from 'split';
import { LauncherEmitter, WRONG_PASSWORD } from './launcherEmitter';
import { nanoid } from 'nanoid';

export async function initializeLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  launcherEmitter: LauncherEmitter,
  password: string,
): Promise<void> {
  const lairHandle = childProcess.spawn(lairBinary, ['init', '-p'], { cwd: keystoreDir });
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();
  return new Promise((resolve) => {
    let killAfterNextLine = false;
    lairHandle.stdout.pipe(split()).on('data', (line: string) => {
      launcherEmitter.emitLairLog(line);
      if (killAfterNextLine) {
        lairHandle.kill();
        resolve();
      }
      if (line.includes('# lair-keystore init config')) {
        killAfterNextLine = true;
      }
    });
  });
}

export async function launchLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  launcherEmitter: LauncherEmitter,
  password: string,
): Promise<[childProcess.ChildProcessWithoutNullStreams, string]> {
  // On Unix systems, there is a limit to the path length of a domain socket. Create a symlink to the lair directory from the tempdir
  // instead and overwrite the connectionUrl in the lair-keystore-config.yaml
  if (os.platform() === 'linux' || os.platform() === 'darwin') {
    try {
      const uid = nanoid(13);
      const srcPath = path.join(os.tmpdir(), `lair.${uid}`);
      fs.symlinkSync(keystoreDir, srcPath);
      keystoreDir = srcPath;
      const lairConfigPath = path.join(keystoreDir, 'lair-keystore-config.yaml');
      const lairConfigString = fs.readFileSync(lairConfigPath, 'utf-8');
      const lines = lairConfigString.split('\n');
      const idx = lines.findIndex((line) => line.includes('connectionUrl:'));
      if (idx === -1)
        throw new Error('Failed to find connectionUrl line in lair-keystore-config.yaml.');
      const connectionUrlLine = lines[idx];
      const socket = connectionUrlLine.split('socket?')[1];
      const tmpDirConnectionUrl = `unix://${keystoreDir}/socket?${socket}`;
      lines[idx] = `connectionUrl: ${tmpDirConnectionUrl}`;
      const newLairConfigString = lines.join('\n');
      fs.writeFileSync(lairConfigPath, newLairConfigString);
    } catch (e) {
      return Promise.reject(`Failed to create symlinked lair directory: ${e}`);
    }
  }
  const lairHandle = childProcess.spawn(lairBinary, ['server', '-p'], { cwd: keystoreDir });
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();
  // Wait for connection url or internal sodium error and return error or EventEmitter
  lairHandle.stderr.pipe(split()).on('data', (line: string) => {
    launcherEmitter.emitLairError(line);
    if (line.includes('InternalSodium')) {
      launcherEmitter.emit(WRONG_PASSWORD);
    }
  });
  lairHandle.stdout.pipe(split()).on('data', (line: string) => {
    launcherEmitter.emitLairLog(line);
    if (line.includes('# lair-keystore connection_url #')) {
      const connectionUrl = line.split('#')[2].trim();
      launcherEmitter.emitLairReady(connectionUrl);
    }
  });

  return new Promise((resolve, reject) => {
    launcherEmitter.on('wrong-password', () => reject('Wrong password.'));
    launcherEmitter.on('lair-ready', (url) => resolve([lairHandle, url as string]));
  });
}
