import React from "react";
import ReactDOM from "react-dom/client";
import {
  PublicClientApplication,
  EventType,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "./authConfig";
import App from "./App";
import "./styles.css";

const msalInstance = new PublicClientApplication(msalConfig);

async function bootstrap() {
  await msalInstance.initialize();

  // Set the active account after a successful interactive sign-in.
  if (
    !msalInstance.getActiveAccount() &&
    msalInstance.getAllAccounts().length > 0
  ) {
    msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0]);
  }

  msalInstance.addEventCallback((event) => {
    if (
      event.eventType === EventType.LOGIN_SUCCESS &&
      event.payload &&
      "account" in event.payload
    ) {
      const payload = event.payload as AuthenticationResult;
      msalInstance.setActiveAccount(payload.account);
    }
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
