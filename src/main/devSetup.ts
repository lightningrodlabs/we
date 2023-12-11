import fs from 'fs';
import os from 'os';
import path from 'path';
import mime from 'mime';

import { HolochainManager } from './holochainManager';
import { createHash, randomUUID } from 'crypto';
import { APPSTORE_APP_ID } from './sharedTypes';
import { DEFAULT_APPS_DIRECTORY } from './paths';
import {
  ActionHash,
  AgentPubKey,
  AppAgentWebsocket,
  AppInfo,
  EntryHash,
  HoloHashB64,
  encodeHashToBase64,
} from '@holochain/client';
import { AppletHash } from '@lightningrodlabs/we-applet';
import { AppAssetsInfo, WeFileSystem } from './filesystem';
import { net } from 'electron';
import { nanoid } from 'nanoid';
import { WeAppletDevInfo } from './cli';
import { EntryRecord } from '@holochain-open-dev/utils';

const rustUtils = require('hc-we-rust-utils');

export async function devSetup(
  config: WeAppletDevInfo,
  holochainManager: HolochainManager,
  weFileSystem: WeFileSystem,
): Promise<void> {
  const logDevSetup = (msg) => console.log(`[APPLET-DEV-MODE - Agent ${config.agentNum}]: ${msg}`);
  logDevSetup(`Setting up agent ${config.agentNum}.`);
  const publishedApplets: Record<string, Entity<AppEntry>> = {};
  const installableApplets: Record<
    string,
    [string, string, string | undefined, string | undefined, string | undefined]
  > = {};

  for (const installableApplet of config.config.applets) {
    logDevSetup(
      `Fetching applet '${installableApplet.name}' from source specified in the config file...`,
    );

    installableApplets[installableApplet.name] = await fetchHappOrWebHappIfNecessary(
      weFileSystem,
      installableApplet.source,
    );
  }

  const appstoreClient = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${holochainManager.appPort}`),
    APPSTORE_APP_ID,
    4000,
  );
  const appstoreCells = await appstoreClient.appInfo();
  for (const [_role_name, [cell]] of Object.entries(appstoreCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(cell['provisioned'].cell_id, {
      All: null,
    });
  }

  for (const group of config.config.groups) {
    // If the running agent is supposed to create the group
    const isCreatingAgent = group.creatingAgent.agentNum === config.agentNum;
    const isJoiningAgent = group.joiningAgents
      .map((info) => info.agentNum)
      .includes(config.agentNum);

    const agentProfile = isCreatingAgent
      ? group.creatingAgent.agentProfile
      : isJoiningAgent
        ? group.joiningAgents.find((agent) => agent.agentNum === config.agentNum)?.agentProfile
        : undefined;

    if (agentProfile) {
      logDevSetup(`Installing group '${group.name}'...`);
      const groupWebsocket = await joinGroup(holochainManager, group, agentProfile);
      if (isCreatingAgent) {
        logDevSetup(`Creating group profile for group '${group.name}'...`);
        const icon_src = await readIcon(group.icon);
        await groupWebsocket.callZome({
          role_name: 'group',
          zome_name: 'group',
          fn_name: 'set_group_profile',
          payload: {
            name: group.name,
            logo_src: icon_src,
          },
        });
      }

      for (const appletInstallConfig of group.applets) {
        const isRegisteringAgent = appletInstallConfig.registeringAgent === config.agentNum;
        const isJoiningAgent = appletInstallConfig.joiningAgents.includes(config.agentNum);

        const appletConfig = config.config.applets.find(
          (appStoreApplet) => appStoreApplet.name === appletInstallConfig.name,
        );
        if (!appletConfig)
          throw new Error(
            "Could not find AppletConfig for the applet that's supposed to be installed.",
          );

        if (isRegisteringAgent) {
          const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
            installableApplets[appletInstallConfig.name];

          // Check whether applet is already published to the appstore - if not publish it
          if (!Object.keys(publishedApplets).includes(appletConfig.name)) {
            logDevSetup(`Publishing applet '${appletInstallConfig.name}' to appstore...`);
            const appletEntryResponse = await publishApplet(
              appstoreClient,
              appletConfig,
              maybeWebHappPath ? maybeWebHappPath : happPath,
            );
            publishedApplets[appletConfig.name] = appletEntryResponse.payload;
          }

          const networkSeed = randomUUID();
          const applet = {
            custom_name: appletConfig.name,
            description: appletConfig.description,
            appstore_app_hash: publishedApplets[appletConfig.name].action,
            network_seed: networkSeed,
            properties: {},
          };
          const appletHash = await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'hash_applet',
            payload: applet,
          });

          const appId = appIdFromAppletHash(appletHash);
          logDevSetup(`Installing applet instance '${appletInstallConfig.instanceName}'...`);
          await installHapp(
            holochainManager,
            appId,
            networkSeed,
            groupWebsocket.myPubKey,
            happPath,
          );
          storeAppAssetsInfo(
            appletConfig,
            appId,
            weFileSystem,
            happPath,
            happHash,
            maybeWebHappPath,
            maybeWebHappHash,
            maybeUiHash,
          );
          logDevSetup(`Registering applet instance '${appletInstallConfig.instanceName}'...`);
          await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'register_applet',
            payload: applet,
          });
        } else if (isJoiningAgent) {
          // Get unjoined applets and join them.
          logDevSetup(`Fetching applets to join for group '${group.name}'...`);

          const unjoinedApplets: Array<[EntryHash, AgentPubKey]> = await groupWebsocket.callZome({
            role_name: 'group',
            zome_name: 'group',
            fn_name: 'get_unjoined_applets',
            payload: null,
          });
          if (unjoinedApplets.length === 0) {
            logDevSetup(
              'Found no applets to join yet. Skipping...You will need to install them manually in the UI once they are gossiped over.',
            );
          }
          logDevSetup(
            `Found applets to join:\n${unjoinedApplets.map(
              ([eh, ak]) => `[
              ${encodeHashToBase64(eh)},
              ${encodeHashToBase64(ak)},
            ]\n`,
            )}`,
          );
          // This is best effort. If applets have not been gossiped over yet, the agent won't be able to join them
          // automatically
          for (const unjoinedApplet of unjoinedApplets) {
            const appletHash = unjoinedApplet[0];
            logDevSetup(
              `Trying to join applet with entry hash ${encodeHashToBase64(appletHash)} ...`,
            );
            const appletRecord = await groupWebsocket.callZome({
              role_name: 'group',
              zome_name: 'group',
              fn_name: 'get_applet',
              payload: appletHash,
            });
            if (!appletRecord) {
              logDevSetup(
                `Applet with entryhash ${encodeHashToBase64(
                  appletHash,
                )} not found in group DHT yet. Skipping...`,
              );
              return undefined;
            }
            const applet = new EntryRecord<Applet>(appletRecord).entry;

            const associatedAppletInstallConfig = group.applets.find(
              (installConfig) => installConfig.instanceName === applet.custom_name,
            );
            const [happPath, happHash, maybeUiHash, maybeWebHappHash, maybeWebHappPath] =
              installableApplets[associatedAppletInstallConfig!.name];

            logDevSetup(`Joining applet instance '${applet.custom_name}'...`);

            const appId = appIdFromAppletHash(appletHash);

            await installHapp(
              holochainManager,
              appId,
              applet.network_seed!,
              groupWebsocket.myPubKey,
              happPath,
            );
            storeAppAssetsInfo(
              appletConfig,
              appId,
              weFileSystem,
              happPath,
              happHash,
              maybeWebHappPath,
              maybeWebHappHash,
              maybeUiHash,
            );
            await groupWebsocket.callZome({
              role_name: 'group',
              zome_name: 'group',
              fn_name: 'register_applet',
              payload: applet,
            });
          }
        }
      }
    }
    // If the running agent is supposed to join the existing group
  }
}

async function joinGroup(
  holochainManager: HolochainManager,
  group: GroupConfig,
  agentProfile: AgentProfile,
): Promise<AppAgentWebsocket> {
  // Create the group
  const appPort = holochainManager.appPort;
  // Install group cell
  const groupAppInfo = await installGroup(holochainManager, group.networkSeed);
  const groupWebsocket = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${appPort}`),
    groupAppInfo.installed_app_id,
  );
  const groupCells = await groupWebsocket.appInfo();
  for (const [_role_name, [cell]] of Object.entries(groupCells.cell_info)) {
    await holochainManager.adminWebsocket.authorizeSigningCredentials(cell['provisioned'].cell_id, {
      All: null,
    });
  }
  const avatarSrc = agentProfile.avatar ? await readIcon(agentProfile.avatar) : undefined;
  await groupWebsocket.callZome({
    role_name: 'group',
    zome_name: 'profiles',
    fn_name: 'create_profile',
    payload: {
      nickname: agentProfile.nickname,
      fields: avatarSrc ? { avatar: avatarSrc } : undefined,
    },
  });
  return groupWebsocket;
}

function appIdFromAppletHash(appletHash: AppletHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

async function readIcon(location: ResourceLocation) {
  switch (location.type) {
    case 'filesystem': {
      const data = fs.readFileSync(location.path);
      const mimeType = mime.getType(location.path);
      return `data:${mimeType};base64,${data.toString('base64')}`;
    }
    case 'https': {
      const response = await net.fetch(location.url);
      const arrayBuffer = await response.arrayBuffer();
      const mimeType = mime.getType(location.url);
      return `data:${mimeType};base64,${_arrayBufferToBase64(arrayBuffer)}`;
    }

    default:
      throw new Error(
        `Fetching icon from source type ${location.type} is not implemented. Got icon source: ${location}.`,
      );
  }
}

async function installGroup(
  holochainManager: HolochainManager,
  networkSeed: string,
): Promise<AppInfo> {
  const apps = await holochainManager.adminWebsocket.listApps({});
  const hash = createHash('sha256');
  hash.update(networkSeed);
  const hashedSeed = hash.digest('base64');
  const appId = `group#${hashedSeed}`;
  const appStoreAppInfo = apps.find((appInfo) => appInfo.installed_app_id === APPSTORE_APP_ID);
  if (!appStoreAppInfo)
    throw new Error('Appstore must be installed before installing the first group.');
  const appInfo = await holochainManager.adminWebsocket.installApp({
    path: path.join(DEFAULT_APPS_DIRECTORY, 'we.happ'),
    installed_app_id: appId,
    agent_key: appStoreAppInfo.agent_pub_key,
    network_seed: networkSeed,
    membrane_proofs: {},
  });
  await holochainManager.adminWebsocket.enableApp({ installed_app_id: appId });
  return appInfo;
}

async function fetchHappOrWebHappIfNecessary(
  weFileSystem: WeFileSystem,
  source: ResourceLocation,
): Promise<[string, string, string | undefined, string | undefined, string | undefined]> {
  switch (source.type) {
    case 'https': {
      const response = await net.fetch(source.url);
      const buffer = await response.arrayBuffer();
      const tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const happOrWebHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
      fs.writeFileSync(happOrWebHappPath, new Uint8Array(buffer));

      const uisDir = path.join(weFileSystem.uisDir);
      const happsDir = path.join(weFileSystem.happsDir);
      const result: string = await rustUtils.saveHappOrWebhapp(happOrWebHappPath, uisDir, happsDir);
      // webHappHash should only be returned if it is actually a webhapp
      const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');
      return [
        happFilePath,
        happHash,
        uiHash ? uiHash : undefined,
        webHappHash ? webHappHash : undefined,
        webHappHash ? happOrWebHappPath : undefined,
      ];
    }
    case 'filesystem': {
      const happOrWebHappPath = source.path;
      const uisDir = path.join(weFileSystem.uisDir);
      const happsDir = path.join(weFileSystem.happsDir);
      const result: string = await rustUtils.saveHappOrWebhapp(happOrWebHappPath, uisDir, happsDir);
      const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');
      return [
        happFilePath,
        happHash,
        uiHash ? uiHash : undefined,
        webHappHash ? webHappHash : undefined,
        webHappHash ? happOrWebHappPath : undefined,
      ];
    }
    case 'localhost':
      const happBytes = fs.readFileSync(source.happPath);
      const hash = createHash('sha256');
      hash.update(happBytes);
      const happHash = hash.digest('base64');
      return [source.happPath, happHash, undefined, undefined, undefined];
    default:
      throw new Error(`Got invalid applet source: ${source}`);
  }
}

async function installHapp(
  holochainManager: HolochainManager,
  appId: string,
  networkSeed: string,
  pubKey: AgentPubKey,
  happPath: string,
): Promise<void> {
  await holochainManager.adminWebsocket.installApp({
    path: happPath,
    installed_app_id: appId,
    agent_key: pubKey,
    network_seed: networkSeed,
    membrane_proofs: {},
  });
  await holochainManager.adminWebsocket.enableApp({ installed_app_id: appId });
}

async function publishApplet(
  appstoreClient: AppAgentWebsocket,
  appletConfig: AppletConfig,
  happOrWebHappPath: string,
): Promise<DevHubResponse<Entity<AppEntry>>> {
  const publisher: DevHubResponse<Entity<PublisherEntry>> = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_publisher',
    payload: {
      name: 'applet-developer',
      location: {
        country: 'in',
        region: 'frontof',
        city: 'myscreen',
      },
      website: {
        url: 'https://duckduckgo.com',
      },
      icon_src: 'unnecessary',
    },
  });

  const source = JSON.stringify({
    type: 'https',
    url: `file://${happOrWebHappPath}`,
  });

  const appletIcon = await readIcon(appletConfig.icon);

  const payload = {
    title: appletConfig.name,
    subtitle: appletConfig.name,
    description: appletConfig.description,
    icon_src: appletIcon,
    publisher: publisher.payload.id,
    source,
    hashes: 'undefined',
    metadata:
      appletConfig.source.type === 'localhost'
        ? JSON.stringify({ uiPort: appletConfig.source.uiPort })
        : undefined,
  };

  return appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_app',
    payload,
  });
}

function storeAppAssetsInfo(
  appletConfig: AppletConfig,
  appId: string,
  weFileSystem: WeFileSystem,
  happPath: string,
  happHash: string,
  maybeWebHappPath?: string,
  maybeWebHappHash?: string,
  maybeUiHash?: string,
) {
  // TODO Store more app metadata
  // Store app metadata
  const appAssetsInfo: AppAssetsInfo =
    appletConfig.source.type === 'localhost'
      ? {
          type: 'webhapp',
          source: {
            type: 'https',
            url: `file://${happPath}`,
          },
          happ: {
            sha256: happHash,
          },
          ui: {
            location: {
              type: 'localhost',
              port: appletConfig.source.uiPort,
            },
          },
        }
      : maybeWebHappHash
        ? {
            type: 'webhapp',
            sha256: maybeWebHappHash,
            source: {
              type: 'https',
              url: `file://${maybeWebHappPath}`,
            },
            happ: {
              sha256: happHash,
            },
            ui: {
              location: {
                type: 'filesystem',
                sha256: maybeUiHash!,
              },
            },
          }
        : {
            type: 'happ',
            sha256: happHash,
            source: {
              type: 'https',
              url: `file://${happPath}`,
            },
          };
  fs.writeFileSync(
    path.join(weFileSystem.appsDir, `${appId}.json`),
    JSON.stringify(appAssetsInfo, undefined, 4),
  );
}

function _arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface WeDevConfig {
  groups: GroupConfig[];
  applets: AppletConfig[];
}

export interface GroupConfig {
  name: string;
  networkSeed: string;
  icon: ResourceLocation; // path to icon
  creatingAgent: AgentSpecifier;
  /**
   * joining agents must be strictly greater than the registering agent since it needs to be done sequentially
   */
  joiningAgents: AgentSpecifier[];
  applets: AppletInstallConfig[];
}

export interface AgentSpecifier {
  agentNum: number;
  agentProfile: AgentProfile;
}

export interface AgentProfile {
  nickname: string;
  avatar?: ResourceLocation; // path to icon
}

export interface AppletInstallConfig {
  name: string;
  instanceName: string;
  registeringAgent: number;
  /**
   * joining agents must be strictly greater than the registering agent since it needs to be done sequentially
   */
  joiningAgents: number[];
}
export interface AppletConfig {
  name: string;
  subtitle: string;
  description: string;
  icon: ResourceLocation;
  source: ResourceLocation;
}

export type ResourceLocation =
  | {
      type: 'filesystem';
      path: string;
    }
  | {
      type: 'localhost';
      happPath: string;
      uiPort: number;
    }
  | {
      type: 'https';
      url: string;
    };

export interface DevHubResponse<T> {
  type: 'success' | 'failure';
  metadata: any;
  payload: T;
}

export interface Entity<T> {
  id: ActionHash;
  action: ActionHash;
  address: EntryHash;
  ctype: string;
  content: T;
}

export interface PublisherEntry {
  name: string;
  location: LocationTriplet;
  website: WebAddress;
  icon_src: String;
  editors: Array<AgentPubKey>;

  // common fields
  author: AgentPubKey;
  published_at: number;
  last_updated: number;
  metadata: any;

  // optional
  description: string | undefined;
  email: string | undefined;
  deprecation: any;
}

export interface AppEntry {
  title: string;
  subtitle: string;
  description: string;
  icon_src: string;
  publisher: ActionHash; // alias EntityId
  source: string;
  hashes: string;
  metadata: string;
  editors: Array<AgentPubKey>;

  author: AgentPubKey;
  published_at: number;
  last_updated: number;
  deprecation?: {
    message: string;
    recommended_alternatives: any;
  };
}

export interface Applet {
  custom_name: string; // name of the applet instance as chosen by the person adding it to the group,
  description: string;
  appstore_app_hash: ActionHash;
  network_seed: string | undefined;
  properties: Record<string, Uint8Array>; // Segmented by RoleId
}

export interface WebAddress {
  url: string;
  context: string | undefined;
}

export interface LocationTriplet {
  country: string;
  region: string;
  city: string;
}