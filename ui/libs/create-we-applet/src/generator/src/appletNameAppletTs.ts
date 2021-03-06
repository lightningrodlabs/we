import { ScFile, ScNodeType } from '@source-craft/types';
import camelCase from 'lodash-es/camelCase';
import kebabCase from 'lodash-es/kebabCase';
import upperFirst from 'lodash-es/upperFirst';
import snakeCase from 'lodash-es/snakeCase';

export const appletNameAppletTs = ({appletNameTitleCase, appletName}: {appletNameTitleCase: string; appletName: string;}): ScFile => ({
  type: ScNodeType.File,
  content: `import { contextProvider, ContextProvider } from "@lit-labs/context";
import { property, state } from "lit/decorators.js";
import {
  ProfilesStore,
  profilesStoreContext,
} from "@holochain-open-dev/profiles";
import { InstalledAppInfo, AppWebsocket } from "@holochain/client";
import { ScopedElementsMixin } from "@open-wc/scoped-elements";
import { CircularProgress } from "@scoped-elements/material-web";
import { LitElement, html, css } from "lit";

export class ${appletNameTitleCase}Applet extends ScopedElementsMixin(LitElement) {
  @property()
  appWebsocket!: AppWebsocket;

  @contextProvider({context: profilesStoreContext})
  @property()
  profilesStore!: ProfilesStore;

  @property()
  appletAppInfo!: InstalledAppInfo;

  @state()
  loaded = false;

  async firstUpdated() {
    // TODO: Initialize any store that you have and create a ContextProvider for it
    //
    // eg:
    // new ContextProvider(this, ${appletName}Context, new ${appletNameTitleCase}Store(cellClient, store));

    this.loaded = true;
  }

  render() {
    if (!this.loaded)
      return html\`<div
        style="display: flex; flex: 1; flex-direction: row; align-items: center; justify-content: center"
      >
        <mwc-circular-progress></mwc-circular-progress>
      </div>\`;

    // TODO: add any elements that you have in your applet
    return html\`<span>This is my applet!</span>\`;
  }

  static get scopedElements() {
    return {
      "mwc-circular-progress": CircularProgress,
      // TODO: add any elements that you have in your applet
    };
  }

  static styles = [
    css\`
      :host {
        display: flex;
        flex: 1;
      }
    \`,
  ];
}
`
});
    