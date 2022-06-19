import {
  $,
  createContext,
  useContext,
  Observable,
  useComputed,
  ObservableReadonly,
  useSample,
  createElement,
  useEffect,
  useCleanup,
  useResolved,
} from 'voby';
import { normalizeIntegration } from 'integration';
import {
  createMemoObject,
  extractSearchParams,
  invariant,
  resolvePath,
  createMatcher,
  joinPaths,
  scoreRoute,
  mergeSearchString,
  urlDecode,
  on,
  expandOptionals,
} from 'utils';
import type {
  Branch,
  Location,
  LocationChange,
  LocationChangeSignal,
  NavigateOptions,
  Navigator,
  Params,
  PathMatch,
  Route,
  RouteContext,
  RouteDataFunc,
  RouteDefinition,
  RouteMatch,
  RouterContext,
  RouterIntegration,
  RouterOutput,
  SetParams,
} from 'types';
import type { FunctionMaybe } from 'voby';

const MAX_REDIRECTS = 100;

interface MaybePreloadableComponent extends JSX.Component {
  preload?: () => void;
}

export const RouterContextObj = createContext<RouterContext>();
export const RouteContextObj = createContext<RouteContext>();

export const useRouter = () =>
  invariant(
    useContext(RouterContextObj),
    'Make sure your app is wrapped in a <Router />'
  );

let TempRoute: RouteContext | undefined;
export const useRoute = () =>
  TempRoute || useContext(RouteContextObj) || useRouter().base;

export const useResolvedPath = (
  path: () => string
): ObservableReadonly<string | undefined> => {
  const route = useRoute();
  return useComputed(() => route.resolvePath(path()));
};

export const useHref = (
  to: () => string | undefined
): ObservableReadonly<string | undefined> => {
  const router = useRouter();
  return useComputed(() => {
    const to_ = to();
    return to_ !== undefined ? router.renderPath(to_) : to_;
  });
};

export const useNavigate = () => useRouter().navigatorFactory();
export const useLocation = <S = unknown>() =>
  useRouter().location as Location<S>;
// export const useIsRouting = () => useRouter().isRouting;

export const useMatch = (
  path: () => string
): ObservableReadonly<PathMatch | null> => {
  const location = useLocation();
  const matcher = useComputed(() => createMatcher(path()));
  return useComputed(() => matcher()(location.pathname));
};

export const useParams = <T extends Params>() => useRoute().params as T;

export const useRouteData = <T>() => useRoute().data as T;

export const useSearchParams = <T extends Params>(): [
  T,
  (params: SetParams, options?: Partial<NavigateOptions>) => void
] => {
  const location = useLocation();
  const navigate = useNavigate();
  const setSearchParams = (
    params: SetParams,
    options?: Partial<NavigateOptions>
  ) => {
    const searchString = useSample(() =>
      mergeSearchString(location.search, params)
    );
    navigate(searchString, { scroll: false, ...options, resolve: true });
  };
  return [location.query as T, setSearchParams];
};

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export function createRoutes(
  routeDef: RouteDefinition,
  base: string = '',
  fallback?: JSX.Component
): Route[] {
  const { component, data, children } = routeDef;
  const isLeaf = !children || (Array.isArray(children) && !children.length);
  // const path = joinPaths(base, originalPath);
  // const pattern = isLeaf ? path : path.split('/*', 1)[0];

  const shared = {
    key: routeDef,
    element: component
      ? () => createElement(component, {})
      : () => {
          const { element } = routeDef;
          return element === undefined && fallback
            ? createElement(fallback, {})
            : element;
        },
    preload: routeDef.component
      ? (component as MaybePreloadableComponent).preload
      : routeDef.preload,
    data
  };

  return asArray(routeDef.path).reduce<Route[]>((acc, path) => {
    for (const originalPath of expandOptionals(path)) {
      const path = joinPaths(base, originalPath);
      const pattern = isLeaf ? path : path.split("/*", 1)[0];
      acc.push({
        ...shared,
        originalPath,
        pattern,
        matcher: createMatcher(pattern, !isLeaf)
      });
    }
    return acc;
  }, []);
}

//   return {
//     originalPath,
//     pattern,
//     element: component
//       ? () => createElement(component, {})
//       : () => {
//           const { element } = routeDef;
//           return element === undefined && fallback
//             ? createElement(fallback, {})
//             : element;
//         },
//     preload: routeDef.component
//       ? (component as MaybePreloadableComponent).preload
//       : routeDef.preload,
//     data,
//     matcher: createMatcher(pattern, !isLeaf),
//   };
// }

export function createBranch(routes: Route[], index: number = 0): Branch {
  return {
    routes,
    score: scoreRoute(routes[routes.length - 1]) * 10000 - index,
    matcher(location) {
      const matches: RouteMatch[] = [];
      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i];
        const match = route.matcher(location);
        if (!match) {
          return null;
        }
        matches.unshift({
          ...match,
          route,
        });
      }
      return matches;
    },
  };
}

export function createBranches(
  routeDef: FunctionMaybe<RouteDefinition | RouteDefinition[]>,
  base: string = '',
  fallback?: JSX.Component,
  stack: Route[] = [],
  branches: Branch[] = []
): Branch[] {
  const routeDefs = asArray(useResolved(routeDef, true));

  for (let i = 0, len = routeDefs.length; i < len; i++) {
    const def = routeDefs[i];
    if (def && typeof def === "object" && def.hasOwnProperty("path")) {
      const routes = createRoutes(def, base, fallback);
      for (const route of routes) {
        stack.push(route);

        if (def.children) {
          createBranches(def.children, route.pattern, fallback, stack, branches);
        } else {
          const branch = createBranch([...stack], branches.length);
          branches.push(branch);
        }

        stack.pop();
      }
    }
  }

  // Stack will be empty on final return
  return stack.length ? branches : branches.sort((a, b) => b.score - a.score);
}

export function getRouteMatches(
  branches: Branch[],
  location: string
): RouteMatch[] {
  for (let i = 0, len = branches.length; i < len; i++) {
    const match = branches[i].matcher(location);
    if (match) {
      return match;
    }
  }
  return [];
}
let prevUrl = new URL('http://sar');
export function createLocation(
  path: Observable<string>,
  state: Observable<any>
): Location {
  const url = useComputed<URL>(
    () => {
      const path_ = path();
      try {
        const url = new URL(path_, origin);
        prevUrl = url;
        return url;
      } catch (err) {
        console.error(`Invalid path ${path_}`);
        return prevUrl;
      }
    },
    {
      equals: (a, b) => a?.href === b?.href,
    }
  );

  const pathname = useComputed(() => urlDecode(url().pathname));
  const search = useComputed(() => urlDecode(url().search, true));
  const hash = useComputed(() => urlDecode(url().hash));
  const key = useComputed(() => '');

  return {
    get pathname() {
      return pathname();
    },
    get search() {
      return search();
    },
    get hash() {
      return hash();
    },
    get state() {
      return state();
    },
    get key() {
      return key();
    },
    query: createMemoObject(on(search, () => extractSearchParams(url()))),
  };
}

export function createRouterContext(
  integration?: RouterIntegration | LocationChangeSignal,
  base: string = '',
  data?: RouteDataFunc,
  out?: object
): RouterContext {
  const {
    signal: [source, setSource],
    utils = {},
  } = normalizeIntegration(integration);

  const parsePath = utils.parsePath || ((p) => p);
  const renderPath = utils.renderPath || ((p) => p);

  const basePath = resolvePath('', base);
  const output = out
    ? (Object.assign(out, {
        matches: [],
        url: undefined,
      }) as RouterOutput)
    : undefined;

  if (basePath === undefined) {
    throw new Error(`${basePath} is not a valid base path`);
  } else if (basePath && !source().value) {
    setSource({ value: basePath, replace: true, scroll: false });
  }

  // const [isRouting, start] = useTransition();
  const reference$ = $(source().value);
  const state$ = $(source().state);
  const location = createLocation(reference$, state$);
  const referrers: LocationChange[] = [];

  const baseRoute: RouteContext = {
    pattern: basePath,
    params: {},
    path: () => basePath,
    outlet: () => null,
    resolvePath(to: string) {
      return resolvePath(basePath, to);
    },
  };

  if (data) {
    try {
      TempRoute = baseRoute;
      baseRoute.data = data({
        data: undefined,
        params: {},
        location,
        navigate: navigatorFactory(baseRoute),
      });
    } finally {
      TempRoute = undefined;
    }
  }

  function navigateFromRoute(
    route: RouteContext,
    to: string | number,
    options?: Partial<NavigateOptions>
  ) {
    // Untrack in case someone navigates in an effect - don't want to track `reference` or route paths
    useSample(() => {
      if (typeof to === 'number') {
        if (!to) {
          // A delta of 0 means stay at the current location, so it is ignored
        } else if (utils.go) {
          utils.go(to);
        } else {
          console.warn('Router integration does not support relative routing');
        }
        return;
      }

      const {
        replace,
        resolve,
        scroll,
        state: nextState,
      } = {
        replace: false,
        resolve: true,
        scroll: true,
        ...options,
      };

      const resolvedTo = resolve ? route.resolvePath(to) : resolvePath('', to);

      if (resolvedTo === undefined) {
        throw new Error(`Path '${to}' is not a routable path`);
      } else if (referrers.length >= MAX_REDIRECTS) {
        throw new Error('Too many redirects');
      }

      const current = reference$();

      if (resolvedTo !== current || nextState !== state$()) {
        const len = referrers.push({
          value: current,
          replace,
          scroll,
          state: state$(),
        });
        // start(() => {
        reference$(resolvedTo);
        state$(nextState);
        // resetErrorBoundaries();
        // }).then(() => {
        if (referrers.length === len) {
          navigateEnd({
            value: resolvedTo,
            state: nextState,
          });
        }
        // });
      }
    });
  }

  function navigatorFactory(route?: RouteContext): Navigator {
    // Workaround for vite issue (https://github.com/vitejs/vite/issues/3803)
    route = route || useContext(RouteContextObj) || baseRoute;
    return (to: string | number, options?: Partial<NavigateOptions>) =>
      navigateFromRoute(route!, to, options);
  }

  function navigateEnd(next: LocationChange) {
    const first = referrers[0];
    if (first) {
      if (next.value !== first.value || next.state !== first.state) {
        setSource({
          ...next,
          replace: first.replace,
          scroll: first.scroll,
        });
      }
      referrers.length = 0;
    }
  }

  useEffect(() => {
    const { value, state } = source();
    useSample(() => {
      if (value !== reference$()) {
        // start(() => {
        reference$(value);
        state$(state);
        // });
      }
    });
  });

  function handleAnchorClick(evt: MouseEvent) {
    if (
      evt.defaultPrevented ||
      evt.button !== 0 ||
      evt.metaKey ||
      evt.altKey ||
      evt.ctrlKey ||
      evt.shiftKey
    )
      return;

    const a = evt
      .composedPath()
      .find((el) => el instanceof Node && el.nodeName.toUpperCase() === 'A') as
      | HTMLAnchorElement
      | SVGAElement
      | undefined;

    if (!a) return;

    const isSvg = a instanceof SVGAElement;
    const href = isSvg ? a.href.baseVal : a.href;
    const target = isSvg ? a.target.baseVal : a.target;
    if (target || (!href && !a.hasAttribute('state'))) return;

    const rel = (a.getAttribute('rel') || '').split(/\s+/);
    if (a.hasAttribute('download') || (rel && rel.includes('external'))) return;

    const url = isSvg ? new URL(href, document.baseURI) : new URL(href);
    const pathname = urlDecode(url.pathname);
    if (
      url.origin !== window.location.origin ||
      (basePath &&
        pathname &&
        !pathname.toLowerCase().startsWith(basePath.toLowerCase()))
    )
      return;

    const to = parsePath(
      pathname + urlDecode(url.search, true) + urlDecode(url.hash)
    );
    const state = a.getAttribute('state');

    evt.preventDefault();
    navigateFromRoute(baseRoute, to, {
      resolve: false,
      replace: a.hasAttribute('replace'),
      scroll: !a.hasAttribute('noscroll'),
      state: state && JSON.parse(state),
    });
  }

  document.addEventListener('click', handleAnchorClick);
  useCleanup(() => document.removeEventListener('click', handleAnchorClick));

  return {
    base: baseRoute,
    out: output,
    location,
    // isRouting,
    renderPath,
    parsePath,
    navigatorFactory,
  };
}

export function createRouteContext(
  router: RouterContext,
  parent: RouteContext,
  child: () => RouteContext,
  match: () => RouteMatch
): RouteContext {
  const { base, location, navigatorFactory } = router;
  const { pattern, element: outlet, preload, data } = match().route;
  const path = useComputed(() => match().path);
  const params = createMemoObject(() => match().params);

  preload?.();

  const route: RouteContext = {
    parent,
    pattern,
    get child() {
      return child();
    },
    path,
    params,
    data: parent.data,
    outlet,
    resolvePath(to: string) {
      return resolvePath(base.path(), to, path());
    },
  };

  if (data) {
    try {
      TempRoute = route;
      route.data = data({
        data: parent.data,
        params,
        location,
        navigate: navigatorFactory(route),
      });
    } finally {
      TempRoute = undefined;
    }
  }

  return route;
}
