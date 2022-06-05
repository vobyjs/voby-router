import { If, useComputed, useMicrotask, useSample } from "voby";
import { pathIntegration } from "./integration";
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
} from "./routing";
import type {
  Location,
  LocationChangeSignal,
  Navigator,
  RouteContext,
  RouteDataFunc,
  RouteDefinition,
  RouteMatch,
  RouterIntegration,
} from "./types";
import { joinPaths, on } from "./utils";

declare global {
  namespace JSX {
    interface AnchorHTMLAttributes<T> {
      state?: string;
      noScroll?: boolean;
      replace?: boolean;
    }
  }
}

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
  const { source, url, base, data, out } = props;
  const integration = source || pathIntegration();
  const routerState = createRouterContext(integration, base, data, out);

  return (
    <RouterContextObj.Provider value={routerState}>{props.children}</RouterContextObj.Provider>
  );
};

export interface RoutesProps {
  base?: string;
  children: JSX.Element;
}

export const Routes = (props: RoutesProps) => {
  const router = useRouter();
  const parentRoute = useRoute();
  const branches = useComputed(() =>
    createBranches(
      props.children as unknown as RouteDefinition | RouteDefinition[],
      joinPaths(parentRoute.pattern, props.base || ""),
      Outlet
    )
  );
  const matches = useComputed(() => getRouteMatches(branches(), router.location.pathname));

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

  const disposers: (() => void)[] = [];
  let root: RouteContext | undefined;
  let prevMatches: RouteMatch[] | undefined;
  let prevValue: RouteContext[] | undefined;
  const routeStates = useComputed(
    on(matches, () => {
      const nextMatches = useSample(matches);
      let equal = prevMatches && nextMatches.length === prevMatches.length;
      const next: RouteContext[] = [];
      for (let i = 0, len = matches.length; i < len; i++) {
        const prevMatch = nextMatches[i];
        const nextMatch = nextMatches[i];

        if (prevValue && prevMatch && nextMatch.route.pattern === prevMatch.route.pattern) {
          next[i] = prevValue[i];
        } else {
          equal = false;
          if (disposers[i]) {
            disposers[i]();
          }

          // createRoot(dispose => {
          //   disposers[i] = dispose;
          useMicrotask(
            () =>
              (next[i] = createRouteContext(
                router,
                next[i - 1] || parentRoute,
                () => routeStates()[i + 1],
                () => matches()[i]
              ))
          );
          // });
        }
      }

      disposers.splice(nextMatches.length).forEach((dispose) => dispose());

      if (prevValue && equal) {
        return prevValue;
      }
      root = next[0];
      prevMatches = [...nextMatches];
      prevValue = [...next];
      return next;
    })
  );

  return (
    <If when={routeStates() && root}>
      {(route: RouteContext) => (
        <RouteContextObj.Provider value={route}>{route.outlet()}</RouteContextObj.Provider>
      )}
    </If>
  );
};

export const useRoutes = (routes: RouteDefinition | RouteDefinition[], base?: string) => () =>
  <Routes base={base}>{routes as any}</Routes>;

export type RouteProps = {
  path: string;
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
    <If when={route.child}>
      {(child: RouteContext) => (
        <RouteContextObj.Provider value={child}>{child.outlet()}</RouteContextObj.Provider>
      )}
    </If>
  );
};

interface LinkBaseProps extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "state"> {
  to: string | undefined;
  state?: unknown;
}

function LinkBase({ children, to, href, state, ...rest }: LinkBaseProps) {
  return (
    <a {...rest} href={useHref(() => to)() || href} state={JSON.stringify(state)}>
      {children}
    </a>
  );
}

export interface LinkProps extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "state"> {
  href: string;
  replace?: boolean;
  noScroll?: boolean;
  state?: unknown;
}

export function Link(props: LinkProps) {
  const to = useResolvedPath(() => props.href);
  return <LinkBase {...props} to={to()} />;
}

export interface NavLinkProps extends LinkProps {
  inactiveClass?: string;
  activeClass?: string;
  end?: boolean;
}

export function NavLink({
  activeClass = "active",
  inactiveClass = "inactive",
  end,
  href,
  ...rest
}: NavLinkProps) {
  const location = useLocation();
  const to = useResolvedPath(() => href);
  const isActive = useComputed(() => {
    const to_ = to();
    if (to_ === undefined) {
      return false;
    }
    const path = to_.split(/[?#]/, 1)[0].toLowerCase();
    const loc = location.pathname.toLowerCase();
    return end ? path === loc : loc.startsWith(path);
  });

  return (
    <LinkBase
      {...rest}
      to={to()}
      class={{ [inactiveClass]: !isActive(), [activeClass]: isActive() }}
      aria-current={isActive() ? "page" : undefined}
    />
  );
}

export interface NavigateProps {
  href: ((args: { navigate: Navigator; location: Location }) => string) | string;
  state?: unknown;
}

export function Navigate(props: NavigateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { href, state } = props;
  const path = typeof href === "function" ? href({ navigate, location }) : href;
  navigate(path, { replace: true, state });
  return null;
}
