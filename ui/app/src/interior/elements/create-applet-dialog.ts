import { css, html, LitElement } from "lit";
import { property, query, state } from "lit/decorators.js";
import { ScopedElementsMixin } from "@open-wc/scoped-elements";
import { contextProvided } from "@lit-labs/context";
import { EntryHashB64 } from "@holochain-open-dev/core-types";
import {
  TextField,
  Card,
  Button,
  Snackbar,
  Dialog,
  CircularProgress,
} from "@scoped-elements/material-web";

import { sharedStyles } from "../../sharedStyles";
import { weContext } from "../context";
import { WeStore } from "../we-store";
import { getAllPublishedApps } from "../../processes/devhub/get-happs";
import { AppletInfo } from "../types";
import { TaskSubscriber } from "lit-svelte-stores";

export class CreateAppletDialog extends ScopedElementsMixin(LitElement) {
  @contextProvided({ context: weContext })
  _weStore!: WeStore;

  _allApplets = new TaskSubscriber(
    this,
    () => this._weStore.fetchAllApplets(),
    () => [this._weStore]
  );

  @query("#applet-dialog")
  _appletDialog!: Dialog;

  @query("#installed-app-id")
  _installedAppIdField!: TextField;

  @state()
  _dnaBundle: { hash: EntryHashB64; file: File } | undefined = undefined;
  @state()
  _uiBundle: { hash: EntryHashB64; setupRenderers: any } | undefined =
    undefined;
  @state()
  _invalidUiBundle = false;

  @state()
  _installableApplets;

  @state()
  _duplicateName: boolean = false;

  @property()
  _appletInfo: AppletInfo = {
    title: "",
    subtitle: "",
    description: "",
    entryHash: new Uint8Array(0),
    icon: undefined,
  };

  open(appletInfo: AppletInfo) {
    this._appletDialog.show();
    this._appletInfo = appletInfo;
  }

  get publishDisabled() {
    return !this._installedAppIdField || this._duplicateName;
  }

  checkValidity(newValue, nativeValidity) {
    if (this._allApplets.value) {
      const allNames = Object.entries(this._allApplets.value!).map(
        ([appletHash, applet]) => applet.name
      );
      if (allNames.includes(this._installedAppIdField.value)) {
        this._duplicateName = true;
        return {
          valid: false,
        };
      }
    }

    this._duplicateName = false;
    return {
      valid: true,
    };
  }

  async createApplet() {
    (this.shadowRoot?.getElementById("installing-progress") as Snackbar).show();
    try {
      const appletEntryHash = await this._weStore.createApplet(
        this._appletInfo,
        this._installedAppIdField.value
      );
      (
        this.shadowRoot?.getElementById("installing-progress") as Snackbar
      ).close();
      (this.shadowRoot?.getElementById("success-snackbar") as Snackbar).show();

      this.dispatchEvent(
        new CustomEvent("applet-installed", {
          detail: { appletEntryHash },
          composed: true,
          bubbles: true,
        })
      );
    } catch (e) {
      (
        this.shadowRoot?.getElementById("installing-progress") as Snackbar
      ).close();
      (this.shadowRoot?.getElementById("error-snackbar") as Snackbar).show();
      console.log("Installation error:", e);
    }
  }

  renderErrorSnackbar() {
    return html`
      <mwc-snackbar
        id="error-snackbar"
        labelText="Installation failed! (See console for details)"
      >
      </mwc-snackbar>
    `;
  }

  renderSuccessSnackbar() {
    return html`
      <mwc-snackbar
        id="success-snackbar"
        labelText="Installation successful"
      ></mwc-snackbar>
    `;
  }

  renderInstallingProgress() {
    return html`
      <mwc-snackbar id="installing-progress" labelText="Installing..." .timeoutMs=${-1}>
      </mwc-snackbar>
    `;
  }

  render() {
    return html`
      ${this.renderErrorSnackbar()} ${this.renderSuccessSnackbar()}
      ${this.renderInstallingProgress()}

      <mwc-dialog id="applet-dialog" heading="Add Custom Name">
        <div class="column" style="padding: 16px; margin-bottom: 24px;">
          <mwc-textfield
            id="installed-app-id"
            label="Custom Name"
            required
            outlined
            autoValidate
            value=${this._appletInfo.title}
            @input=${() => this.requestUpdate()}
            validateOnInitialRender
            dialogInitialFocus
            .validityTransform=${(newValue, nativeValidity) =>
              this.checkValidity(newValue, nativeValidity)}
          ></mwc-textfield>
          ${this._duplicateName
            ? html`<div
                class="default-font"
                style="color: #b10323; font-size: 12px; margin-left: 4px;"
              >
                Name already exists.
              </div>`
            : html``}
        </div>

        <mwc-button
          slot="secondaryAction"
          dialogAction="cancel"
          label="cancel"
        ></mwc-button>
        <mwc-button
          id="primary-action-button"
          .disabled=${this.publishDisabled}
          slot="primaryAction"
          dialogAction="close"
          label="INSTALL"
          @click=${() => this.createApplet()}
        ></mwc-button>
      </mwc-dialog>
    `;
  }

  static get scopedElements() {
    return {
      "mwc-textfield": TextField,
      "mwc-button": Button,
      "mwc-dialog": Dialog,
      "mwc-snackbar": Snackbar,
      "mwc-circular-progress": CircularProgress,
    };
  }

  static get styles() {
    return sharedStyles;
  }
}
