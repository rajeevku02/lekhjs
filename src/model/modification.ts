// The `ModificationContext` of a drag on a page: the page's store, the document's snap step, and
// how a container builds the group dragged with it (C++ `new GroupObject(objs)`).
import type { Length } from '../style';
import { GroupObject } from './group-object';
import type { LekhObject, ModificationContext, SceneQuery } from './lekh-object';
import type { ObjectEnv } from './object-env';
import { TemplatedObject } from './templated-object';

export function modificationContext(env: ObjectEnv, scene: SceneQuery, snapStep: Length): ModificationContext {
  return {
    scene,
    snapStep,
    makeGroup: (members: readonly LekhObject[]) =>
      new GroupObject(
        env,
        members.filter((m): m is TemplatedObject => m instanceof TemplatedObject),
      ),
  };
}
