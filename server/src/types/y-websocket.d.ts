declare module 'y-websocket/bin/utils' {
  export function setupWSConnection(ws: any, req: any, options?: any): void;
  export function getYDoc(docName: string, gc?: boolean): any;
  export function setPersistence(persistence: any): void;
  export function getPersistence(): any;
  export const docs: Map<string, any>;
}
