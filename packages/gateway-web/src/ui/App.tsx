import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { DashboardPage } from './routes/DashboardPage';
import { ComposerPage } from './routes/ComposerPage';

type AppRoute = 'composer' | 'monitor';

export function App(): ReactElement {
  const [route, setRoute] = useState(readRoute());

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (route === 'monitor') {
    return <DashboardPage />;
  }

  return <ComposerPage />;
}

function readRoute(): AppRoute {
  if (window.location.pathname === '/monitor') {
    return 'monitor';
  }

  return 'composer';
}
