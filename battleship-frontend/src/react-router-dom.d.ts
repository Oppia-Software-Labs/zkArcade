declare module 'react-router-dom' {
  import type { ReactNode } from 'react';
  export function BrowserRouter(props: { children?: ReactNode }): JSX.Element;
  export function Routes(props: { children?: ReactNode }): JSX.Element;
  export function Route(props: {
    path?: string;
    element?: ReactNode;
    children?: ReactNode;
  }): JSX.Element;
}
