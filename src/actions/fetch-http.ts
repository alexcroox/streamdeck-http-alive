import streamDeck, {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";

/**
 * Settings for {@link FetchHttp}.
 */
type PluginSettings = {
  endpoint?: string;
  healthyStatusCode?: number;
  checkSeconds?: number;
};

@action({ UUID: "com.alex-crooks.http-alive.increment" })
export class FetchHttp extends SingletonAction<PluginSettings> {
  fetchTimer: null | NodeJS.Timeout = null;
  alertIconTimer: null | NodeJS.Timeout = null;
  log = streamDeck.logger;
  minFrequencyMs = 30000;
  defaultHealthyStatusCode = 200;
  endpoints: Map<
    string,
    {
      url: string | undefined;
      isOnline: boolean;
      isVisible: boolean;
      healthyStatusCode: number;
      checkSeconds: number;
      lastChecked: number;
      showAlert: () => void;
      showOk: () => void;
    }
  > = new Map();

  /**
   * The {@link SingletonAction.onWillAppear} event is useful for setting the visual representation of an action when it becomes visible. This could be due to the Stream Deck first
   * starting up, or the user navigating between pages / folders etc.. There is also an inverse of this event in the form of {@link streamDeck.client.onWillDisappear}. In this example,
   * we're setting the title to the "count" that is incremented in {@link FetchHttp.onKeyDown}.
   */
  override onWillAppear(
    event: WillAppearEvent<PluginSettings>
  ): void | Promise<void> {
    this.startFetchTimer();
    this.startAlertIconTimer();
    this.fetchEndpoints();

    const keyId = event.action.id;

    const { settings } = event.payload;

    const existingEndpoint = this.endpoints.get(keyId);

    if (existingEndpoint) {
      existingEndpoint.url = settings.endpoint;
      existingEndpoint.healthyStatusCode = Number(
        settings.healthyStatusCode || this.defaultHealthyStatusCode
      );
      existingEndpoint.checkSeconds = Number(
        settings.checkSeconds || this.minFrequencyMs / 1000
      );
    } else {
      this.endpoints.set(keyId, {
        url: settings.endpoint,
        isOnline: true,
        isVisible: true,
        lastChecked: 0,
        checkSeconds: Number(
          settings.checkSeconds || this.minFrequencyMs / 1000
        ),
        healthyStatusCode: Number(
          settings.healthyStatusCode || this.defaultHealthyStatusCode
        ),
        showAlert: () => event.action.showAlert(),
        showOk: () => event.action.showOk(),
      });
    }
  }

  override onWillDisappear(
    event: WillDisappearEvent<PluginSettings>
  ): void | Promise<void> {
    this.log.info("On dissapear");

    const keyId = event.action.id;

    const endpoint = this.endpoints.get(keyId);

    // We don't want to fetch this endpoint if the key isn't visible
    if (endpoint) {
      endpoint.isVisible = false;
    }
  }

  override async onKeyDown(event: KeyDownEvent<PluginSettings>): Promise<void> {
    const keyId = event.action.id;

    this.fetchEndpoint(keyId, true);

    if (this.endpoints.has(keyId)) {
      const endpoint = this.endpoints.get(keyId);

      if (endpoint?.url) {
        streamDeck.system.openUrl(endpoint.url);
      }
    }
  }

  override async onDidReceiveSettings(
    event: DidReceiveSettingsEvent<PluginSettings>
  ): Promise<void> {
    const { settings } = event.payload;

    const keyId = event.action.id;

    const endpoint = this.endpoints.get(keyId);

    if (endpoint) {
      endpoint.url = settings.endpoint;
      endpoint.healthyStatusCode = Number(
        settings.healthyStatusCode || this.defaultHealthyStatusCode
      );
      endpoint.checkSeconds = Number(
        settings.checkSeconds || this.minFrequencyMs / 1000
      );
    }

    this.fetchEndpoint(event.action.id, true);
  }

  startFetchTimer() {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
    }

    this.fetchTimer = setInterval(() => {
      this.fetchEndpoints();
    }, this.minFrequencyMs);

    this.fetchEndpoints();
  }

  // We want a continual flashing of alerts
  startAlertIconTimer() {
    if (this.alertIconTimer) {
      return;
    }

    this.alertIconTimer = setInterval(() => {
      this.showAlerts();
    }, 4000);

    this.showAlerts();
  }

  clearAlertIconTimer() {
    if (this.alertIconTimer) {
      clearInterval(this.alertIconTimer);
    }
  }

  // Loop through endpoints and showAlert for any offline
  showAlerts() {
    this.endpoints.forEach((endpoint) => {
      if (!endpoint.isOnline) {
        endpoint.showAlert();
      }
    });
  }

  fetchEndpoints() {
    // Loop through endpoints and fetch each one in parrallel
    this.endpoints.forEach((_endpoint, keyId) => {
      this.fetchEndpoint(keyId);
    });
  }

  fetchEndpoint(keyId: string, force = false) {
    const endpoint = this.endpoints.get(keyId);

    if (!endpoint?.url || !endpoint.isVisible) {
      return;
    }

    // Has endpoint been checked in the last checkSeconds, give a 2 second buffer
    if (
      endpoint.lastChecked + endpoint.checkSeconds * 1000 > Date.now() - 2000 &&
      !force
    ) {
      return;
    }

    this.log.info(`Fetching ${endpoint.url}`);

    fetch(endpoint.url, { signal: AbortSignal.timeout(3000) })
      .then((response) => {
        if (response.status === endpoint.healthyStatusCode) {
          if (endpoint.isOnline === false) {
            endpoint.showOk();
          }

          endpoint.isOnline = true;
        } else {
          endpoint.isOnline = false;
        }
      })
      .catch(() => {
        endpoint.isOnline = false;
      })
      .finally(() => {
        endpoint.lastChecked = Date.now();
      });
  }
}
