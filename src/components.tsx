import { FunctionMaybe, If, useMemo } from 'voby';
import { pathIntegration } from 'integration';
import {
  createBranches,
  createRouteContext,
  createRouterContext,
  getRouteMatches,
  RouteContextObj,
  RouterContextObj,
  useHref,
  useLocation,
  useNavigate,
  useResolvedPath,
  useRoute,
  useRouter,
} from 'routing';
import type {
  Location,
  LocationChangeSignal,
  Navigator,
  RouteContext,
  RouteDataFunc,
  RouteDefinition,
  RouteMatch,
  RouterIntegration,
} from 'types';
import { joinPaths, on } from 'utils';

export type RouterProps = {
  base?: string;
  data?: RouteDataFunc;
  children: JSX.Element;
  out?: object;
} & (
  | {
      url?: never;
      source?: RouterIntegration | LocationChangeSignal;
    }
  | {
      source?: never;
      url: string;
    }
);

export const Router = (props: RouterProps) => {
  const { source, base, data, out } = props;
  const integration = source || pathIntegration();
  const routerState = createRouterContext(integration, base, data, out);

  return (
    <RouterContextObj.Provider value={routerState}>
      {props.children}
    </RouterContextObj.Provider>
  );
};

export interface RoutesProps {
  base?: string;
  children: JSX.Element;
}

export const Routes = (props: RoutesProps) => {
  const router = useRouter();
  const parentRoute = useRoute();
  const branches = useMemo(() =>
    createBranches(
      props.children as unknown as FunctionMaybe<
        RouteDefinition | RouteDefinition[]
      >,
      joinPaths(parentRoute.pattern, props.base || ''),
      Outlet
    )
  );
  const matches = useMemo(() =>
    getRouteMatches(branches(), router.location.pathname)
  );

  if (router.out) {
    router.out.matches.push(
      matches().map(({ route, path, params }) => ({
        originalPath: route.originalPath,
        pattern: route.pattern,
        path,
        params,
      }))
    );
  }

  let root: RouteContext | undefined;
  let prevMatches: RouteMatch[] | undefined;
  let prev: RouteContext[] | undefined;

  const routeStates = useMemo(
    on(matches, () => {
      let equal = matches().length === prevMatches?.length;
      const next: RouteContext[] = [];
      for (let i = 0, len = matches().length; i < len; i++) {
        const prevMatch = prevMatches?.[i];
        const nextMatch = matches()[i];

        if (prev && prevMatch && nextMatch.route.key === prevMatch.route.key) {
          next[i] = prev[i];
        } else {
          equal = false;
          next[i] = createRouteContext(
            router,
            next[i - 1] || parentRoute,
            () => routeStates()[i + 1],
            () => matches()[i]
          );
        }
      }

      if (prev && equal) return prev;
      root = next[0];
      prevMatches = [...matches()];
      prev = [...next];
      return next;
    })
  );

  return (
    <If when={() => routeStates() && root}>
      {(route) => (
        <RouteContextObj.Provider value={route()}>
          {() => route().outlet()}
        </RouteContextObj.Provider>
      )}
    </If>
  );
};

export const useRoutes =
  (routes: RouteDefinition | RouteDefinition[], base?: string) => () =>
    <Routes base={base}>{routes as unknown as JSX.Child}</Routes>;

export type RouteProps = {
  path: string | string[];
  children?: JSX.Element;
  data?: RouteDataFunc;
} & (
  | {
      element?: never;
      component: JSX.Component;
    }
  | {
      component?: never;
      element?: JSX.Element;
      preload?: () => void;
    }
);

export const Route = (props: RouteProps) => props as unknown as JSX.Element;

export const Outlet = () => {
  const route = useRoute();
  return (
    <If when={() => route.child}>
      {(child) => (
        <RouteContextObj.Provider value={child()}>
          {() => child().outlet()}
        </RouteContextObj.Provider>
      )}
    </If>
  );
};

// interface LinkBaseProps
//   extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'state'> {
//   to: string | undefined;
//   state?: unknown;
// }

// function LinkBase({ children, to, href, state, ...rest }: LinkBaseProps) {
//   return (
//     <a
//       {...rest}
//       href={useHref(() => to)() || href}
//       state={JSON.stringify(state)}
//     >
//       {children}
//     </a>
//   );
// }

export interface AnchorProps
  extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'state'> {
  href: string;
  replace?: boolean;
  noScroll?: boolean;
  state?: unknown;
  inactiveClass?: string;
  activeClass?: string;
  end?: boolean;
}

export function A({
  activeClass = 'active',
  inactiveClass = 'inactive',
  children,
  class: class_,
  end,
  href,
  state,
  ...rest
}: AnchorProps) {
  const to = useResolvedPath(() => href);
  const location = useLocation();
  const isActive = useMemo(() => {
    const to_ = to();
    if (to_ === undefined) return false;
    const path = to_.split(/[?#]/, 1)[0].toLowerCase();
    const loc = location.pathname.toLowerCase();
    return end ? path === loc : loc.startsWith(path);
  });

  return (
    <a
      link
      {...rest}
      href={useHref(to)() ?? href}
      state={JSON.stringify(state)}
      class={() => [
        {
          [inactiveClass]: !isActive(),
          [activeClass]: isActive(),
        },
        class_,
      ]}
      aria-current={() => isActive() ? 'page' : undefined}
    >
      {children}
    </a>
  );
}

// deprecated alias exports
export {
  A as Link,
  A as NavLink,
  AnchorProps as LinkProps,
  AnchorProps as NavLinkProps,
};

export interface NavigateProps {
  href:
    | ((args: { navigate: Navigator; location: Location }) => string)
    | string;
  state?: unknown;
}

export function Navigate(props: NavigateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { href, state } = props;
  const path = typeof href === 'function' ? href({ navigate, location }) : href;
  navigate(path, { replace: true, state });
  return null;
}
