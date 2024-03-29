import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiAccountLockOpen, mdiAccountMultiplePlus, mdiViewGridPlus } from '@mdi/js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import '../../elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';

enum WelcomePageView {
  Main,
}
@localized()
@customElement('welcome-view')
export class WelcomeView extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @state()
  view: WelcomePageView = WelcomePageView.Main;

  @state()
  notificationsLoading = true;

  _notificationFeed = new StoreSubscriber(
    this,
    () => this._mossStore.notificationFeed(),
    () => [this._mossStore],
  );

  async firstUpdated() {
    try {
      console.log('@ WELCOME-VIEW: loading notifications');
      const runningApplets = await toPromise(this._mossStore.runningApplets);
      const daysSinceEpoch = Math.floor(Date.now() / 8.64e7);
      // load all notification of past 2 days since epoch
      runningApplets.forEach((appletHash) => {
        const appletId = encodeHashToBase64(appletHash);
        this._mossStore.updateNotificationFeed(appletId, daysSinceEpoch);
        this._mossStore.updateNotificationFeed(appletId, daysSinceEpoch - 1);
      });
      this.notificationsLoading = false;
      console.log('Updated notifications.');
    } catch (e) {
      console.error('Failed to load notification feed: ', e);
    }
  }

  resetView() {
    this.view = WelcomePageView.Main;
  }

  renderExplanationCard() {
    return html`
      <sl-card style="flex: 1">
        <span class="title" slot="header">${msg('What is We?')}</span>
        <div class="column" style="text-align: left; font-size: 1.15em;">
          <span>${msg('We is a group collaboration OS.')}</span>
          <br />
          <span
            >${msg(
              'In We, first you create a group, and then you install applets to that group.',
            )}</span
          >
          <br />
          <span>${msg('You can see all the groups you are part of in the left sidebar.')}</span>
          <br />
          <span
            >${msg(
              'You can also see all the applets that you have installed in the top sidebar, if you have any.',
            )}</span
          >
          <br />
          <span
            >${msg(
              'WARNING! We is in alpha version, which means that is not ready for production use yet. Expect bugs, breaking changes, and to lose all the data for all groups when you upgrade to a new version of We.',
            )}</span
          >
        </div>
      </sl-card>
    `;
  }

  renderManagingGroupsCard() {
    return html`
      <sl-card style="flex: 1; margin-left: 16px">
        <span class="title" slot="header">${msg('Managing Groups')}</span>
        <div style="text-align: left; font-size: 1.15em;">
          <ol style="line-height: 180%; margin: 0;">
            <li>
              ${msg('To create a new group, click on the "Add Group"')}
              <sl-icon
                style="position: relative; top: 0.25em;"
                .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
              ></sl-icon>
              ${msg('button in the left sidebar.')}
            </li>
            <li>
              ${msg(
                'After creating a group, create a profile for this group. Only the members of that group are going to be able to see your profile.',
              )}
            </li>
            <li>
              ${msg('Invite other members to the group by sharing the group link with them.')}
            </li>
            <li>${msg('Install applets that you want to use as a group.')}</li>
          </ol>
        </div>
      </sl-card>
    `;
  }

  render() {
    switch (this.view) {
      case WelcomePageView.Main:
        return html`
          <div class="column" style="align-items: center; flex: 1; overflow: auto;">
            <div class="row" flex-wrap: wrap;">
              <button
                class="btn"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('request-create-group', {
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('request-create-group', {
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${msg('Create Group')}</span>
                </div>
              </button>
              <button
                class="btn"
                @click=${() => {
                  this.dispatchEvent(new CustomEvent('open-appstore'));
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(new CustomEvent('open-appstore'));
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiViewGridPlus)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${msg('Add Applet')}</span>
                </div>
              </button>
              <button
                class="btn"
                @click=${(_e) =>
                  this.dispatchEvent(
                    new CustomEvent('request-join-group', {
                      composed: true,
                      bubbles: true,
                    }),
                  )}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('request-join-group', {
                        composed: true,
                        bubbles: true,
                      }),
                    );
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiAccountLockOpen)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${'Join Group'}</span>
                </div>
              </button>
            </div>

            <!-- Notification Feed -->

            <div class="column" style="align-items: center; display:flex; flex: 1; width: 100%;">
              <div class="row recent-activity-header">
                <img
                  src="raindrops.svg"
                  style="height: 24px; margin-right: 10px; position: relative; bottom: -5px; filter: invert(95%) sepia(42%) saturate(4437%) hue-rotate(178deg) brightness(96%) contrast(95%);"
                />
                <h1>Recent Activity</h1>
              </div>
              <div class="column feed" style="display:flex; flex: 1;width: 100%;">
                ${this.notificationsLoading ? html`Loading Notifications...` : html``}
                ${this.notificationsLoading
                  ? html``
                  : this._notificationFeed.value.map(
                      (appletNotification) => html`
                        <feed-element .notification=${appletNotification}></feed-element>
                      `,
                    )}
                <div style="min-height: 30px;"></div>
              </div>
            </div>
          </div>
        `;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        background-color: rgba(57, 67, 51, 1.0);
        /* opacity: 0.8; */
      }

      .recent-activity-header {
        color: #fff;
        opacity: .5;
        text-align: left;
      }

      .recent-activity-header h1 {
        font-size: 16px;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 16px;
        padding: 10px;
        background: transparent;
        border: 2px solid #607C02;
        color: white;
        border-radius: 10px;
        cursor: pointer;
        transition: all .25s ease;
      }

      .btn:hover {
        background: #607C02;
      }

      .btn:active {
        background: var(--sl-color-secondary-300);
      }

      .feed {
        max-height: calc(100vh - 200px);
        overflow-y: auto;
      }

      .feed::-webkit-scrollbar {
        background-color: rgba(57, 67, 51, 1.0);
      }

      .feed::-webkit-scrollbar-thumb {
        background: rgba(84, 109, 69, 1.0);
        border-radius: 10px;
      }
    `,
    weStyles,
  ];
}
