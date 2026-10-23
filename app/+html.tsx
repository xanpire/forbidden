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
  }
  * {
    -webkit-tap-highlight-color: transparent;
  }
  ::selection {
    background: #E50914;
    color: #FFFFFF;
  }
`;

const serviceWorker = `
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
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
        <title>Kan — A Naruto Story</title>
        <meta
          content="An AI-driven roleplaying story. Play as Kan, an original shinobi in the world of Naruto."
          name="description"
        />
        <meta content="#050505" name="theme-color" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content="yes" name="apple-mobile-web-app-capable" />
        <meta content="black-translucent" name="apple-mobile-web-app-status-bar-style" />
        <meta content="Kan" name="apple-mobile-web-app-title" />
        <link href="/manifest.webmanifest" rel="manifest" />
        <link href="/apple-touch-icon.png" rel="apple-touch-icon" sizes="180x180" />
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
