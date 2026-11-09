import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const pageStyles = `
  html, body {
    background-color: #050505;
    color-scheme: dark;
  }
  body {
    margin: 0;
    overscroll-behavior-y: none;
    -webkit-font-smoothing: antialiased;
  }
  #root {
    min-height: 100%;
    background-color: #050505;
  }
  * {
    -webkit-tap-highlight-color: transparent;
  }
  /* App text is not selectable, so a long press on the phone never grabs
     words. Only fields you type in (your action, settings, names) can be
     selected and edited. */
  body, body * {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  input, textarea, [contenteditable="true"] {
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
  }
  ::selection {
    background: #E50914;
    color: #FFFFFF;
  }
`;

// Keeps open copies of the app on the latest deploy. Every deploy ships a new
// sw.js; we check for it on load, when the app comes back to the foreground
// and every 10 minutes. When the new worker takes over, the page reloads, but
// never while the player is looking at it: it waits until the app is in the
// background, so nothing is cut off mid-scene.
const serviceWorker = `
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    var pendingReload = false;
    function reloadWhenHidden() {
      if (document.visibilityState === 'hidden') { location.reload(); }
      else { pendingReload = true; }
    }
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      reloadWhenHidden();
    });
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
      function check() { reg.update().catch(function () {}); }
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && pendingReload) { location.reload(); }
        if (document.visibilityState === 'visible') { check(); }
      });
      setInterval(check, 10 * 60 * 1000);
    }).catch(function () {});
  }
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <title>frbddn — Sandbox Roleplay</title>
        <meta
          content="A sandbox roleplay game: be anyone, in any world you write."
          name="description"
        />
        <meta content="#050505" name="theme-color" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content="yes" name="apple-mobile-web-app-capable" />
        <meta content="black-translucent" name="apple-mobile-web-app-status-bar-style" />
        <meta content="frbddn" name="apple-mobile-web-app-title" />
        <link href="/manifest.webmanifest?v=2.8.0" rel="manifest" />
        <link href="/apple-touch-icon.png?v=2.8.0" rel="apple-touch-icon" sizes="180x180" />
        <link href="/icon-192.png?v=2.8.0" rel="icon" sizes="192x192" type="image/png" />
        <link href="/icon-512.png?v=2.8.0" rel="icon" sizes="512x512" type="image/png" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: serviceWorker }} />
      </body>
    </html>
  );
}
