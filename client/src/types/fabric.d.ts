import 'fabric';

declare module 'fabric' {
  namespace fabric {
    interface IObjectOptions {
      id?: string;
      creatorId?: string;
    }
    interface Object {
      id?: string;
      creatorId?: string;
    }
  }
}
