
export const SINGLETON = 'REFLECT.UTIL:SINGLETON';
const SET_PROPS = 'REFLECT.UTIL:SET_PROPS';

export const setReflectProperty = <T extends Object>(entity:T, inEntity: any, type?: string ): T => {
  type = type ? `${SET_PROPS}__${type}` : SET_PROPS;

  Reflect.defineMetadata(type, entity, inEntity)

  return entity;
}

export const getReflectProperty = <T>(fromEntity: any, type?: string ): T => {
  type = type ? `${SET_PROPS}__${type}` : SET_PROPS;

  return Reflect.getMetadata(type, fromEntity) as T;

}