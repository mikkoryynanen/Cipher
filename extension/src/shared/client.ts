import type { Request, ResponseFor } from "./messages";

/** Send a typed request to the service worker. */
export function send<R extends Request>(req: R): Promise<ResponseFor<R>> {
  return chrome.runtime.sendMessage(req) as Promise<ResponseFor<R>>;
}

export type Send = <R extends Request>(req: R) => Promise<ResponseFor<R>>;
