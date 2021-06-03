import { NativeModules } from 'react-native';
import { FirebaseError, isFunction, isPromise } from '../common';
import RNFBNativeEventEmitter from '../RNFBNativeEventEmitter';
import SharedEventEmitter from '../SharedEventEmitter';

import { NativeModule, NativeNamespace, NativeModuleOptions } from './types';

// Cache of native modules.
const MODULE_CACHE: {
  [key in NativeNamespace]?: {
    [nativeModule: string]: NativeModule;
  };
} = {};

// Store holding reference to whether an event subscription has been created.
const EVENT_SUBSCRIPTION_CACHE: { [key: string]: true } = {};

export function getNativeModule<T = unknown>(options: NativeModuleOptions): NativeModule<T> {
  const { namespace, nativeModule, config } = options;

  // Return a cached module if it exists.
  if (MODULE_CACHE?.[namespace]?.[nativeModule]) {
    return MODULE_CACHE[namespace]?.[nativeModule] as NativeModule<T>;
  }

  const module = NativeModules[nativeModule];

  if (!module) {
    throw new Error(
      `You attempted to use the Firebase module "${namespace}" which is not installed natively on your project.` +
        '\r\n\r\nSee https://rnfirebase.io/ for full setup instructions.',
    );
  }

  // Subscribe to any requested events.
  if (config?.events?.length) {
    for (const event of config.events) {
      _subscribeToNativeEvent(event);
    }
  }

  const _module = {
    emitter: SharedEventEmitter,
    module: new Proxy<any>(module as T, {
      get(target, prop) {
        const maybeFunction = target[prop];

        if (!isFunction(maybeFunction)) {
          return maybeFunction;
        }

        return (...args: any[]) => {
          const result = maybeFunction(...args);

          if (isPromise(result)) {
            return result.catch((nativeError: NativeError) => {
              const error = new Error(nativeError.userInfo.message || nativeError.message);
              return Promise.reject(
                new FirebaseError(
                  error,
                  options.namespace,
                  nativeError.userInfo.code,
                  nativeError.userInfo,
                ),
              );
            });
          }

          return result;
        };
      },
    }),
  };

  // Cache the module.
  if (!MODULE_CACHE[namespace]) MODULE_CACHE[namespace] = {};
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  MODULE_CACHE[namespace]![nativeModule] = _module;

  return _module;
}

/**
 * When native rejects a promise, the data returned is an object,
 * which needs then constructing into a JavaScript error.
 */
type NativeError = {
  // The raw error from Native
  message: string;
  // Custom returned data from the error.
  userInfo: {
    // A Firebase error code.
    code?: string;
    // A user friendly message of an error.
    message?: string;
    // Native returned error code.
    nativeErrorCode?: string;
    // Native returned message.
    nativeErrorMessage?: string;
  };
};

/**
 * Creates a native subscription for a given event name.
 *
 * When an event is received from the native event emitter, it is forwarded onto
 * the JavaScript shared event emitter.
 *
 * @param type
 * @returns
 */
function _subscribeToNativeEvent(type: string) {
  if (EVENT_SUBSCRIPTION_CACHE[type]) {
    return;
  }

  RNFBNativeEventEmitter.addListener(type, event => {
    if (event.appName) {
      SharedEventEmitter.emit(`${event.appName}-${event.eventName}`, event);
    } else {
      SharedEventEmitter.emit(event.eventName, event);
    }
  });

  EVENT_SUBSCRIPTION_CACHE[type] = true;
}