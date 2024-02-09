import { customElement, state, property } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { consume } from '@lit/context';
import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@lightningrodlabs/we-elements/dist/elements/we-client-context.js';

import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import './hrl-element.js';
import './clipboard-search.js';
import { CreatableInfo } from './creatable-panel.js';
import { Unsubscriber } from '@holochain-open-dev/stores';

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('creatable-view')
export class CreatableView extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  _weStore!: WeStore;

  @property()
  dialogId!: string;

  @property()
  creatableInfo!: CreatableInfo;

  @state()
  _unsubscribe: Unsubscriber | undefined;

  updateStoreSubscriber() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = this._weStore.creatableDialogResult(this.dialogId).subscribe((value) => {
      if (value) {
        this.dispatchEvent(
          new CustomEvent('creatable-response-received', {
            detail: value,
            composed: true,
          }),
        );
      }
    });
  }

  disconnectedCallback(): void {
    if (this._unsubscribe) this._unsubscribe();
  }

  render() {
    this.updateStoreSubscriber();
    return html`
      <applet-view
        style="flex: 1"
        .appletHash=${this.creatableInfo.appletHash}
        .view=${{
          type: 'creatable',
          creatableName: this.creatableInfo.creatableName,
          dialogId: this.dialogId,
          // resolve and reject functions are not relevant for the query string
        }}
      >
      </applet-view>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
        }
      `,
    ];
  }
}
