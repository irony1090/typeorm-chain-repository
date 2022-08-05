import { ArrayElementType, Bridge, PathString, Relation, StartString, deepClone, deepSelectFlatMap, entriesTypeGuard, getIdsRecord, getPick, isContains, setFieldRelation } from "@irony0901/toolbox";
import { isUndeclared, isBlank } from "@irony0901/format";
// import { ArrayElementType, Bridge, PathString, Relation, StartString } from "@irony0901/toolbox/type";
import { DeepPartial, EntityManager, ObjectLiteral, ObjectType, QueryRunner, Repository, SaveOptions, SelectQueryBuilder } from "typeorm";
import { getReflectProperty, setReflectProperty } from "util/reflect.util";

export * from '@irony0901/toolbox';

export type BridgesProps<Self> = {
  entityManager: EntityManager;
  selfEntities: Array<Self>;
}
export type DatasProps<Self, Inverse> = {
  entityManager: EntityManager;
  details: Array<StartString<keyof Inverse, '.'>>;
  selfEntities: Array<Self>;
  bridgesPromise: Promise<Array<Bridge<Self, Inverse>>>;
}

export type ExistChainRepository<Self, Inverse> = {
  Entity: ObjectType<Inverse>;
  Repository: ObjectType<Repository<Inverse>>;
  fieldIsMany?: boolean;
  getBridges: (props: BridgesProps<Self>) => Promise<Array<Bridge<Self, Inverse>>>;
}
export type NotExistChainRepository<Self, Inverse> = {
  Entity: ObjectType<Inverse>;
  Repository?: undefined;
  fieldIsMany?: boolean;
  getBridges: (props: BridgesProps<Self>) => Promise<Array<Bridge<Self, Inverse>>>;
  getDatas: (props: DatasProps<Self, Inverse>) => Promise<Array<Inverse>>;
}

type ChainSetPropertyParam<T, P> = {
  details: Array<P>;
  entities: Array<T>;
  relay?: any;
  data?: any;
}
export type SetPropertyEvent<T, P> = {
  where: (setPropertyParam: ChainSetPropertyParam<T, P>) => boolean;
  details?: Array<P>;
  before?: (setPropertyParam: ChainSetPropertyParam<T, P>) => void|Promise<void>;
  after?: (setPropertyParam: ChainSetPropertyParam<T, P>) => void|Promise<void>;
}

export type ChainSetting<Self, Inverse> = 
  ExistChainRepository<Self, Inverse>
  | NotExistChainRepository<Self, Inverse>

export type ChainRelation<T> = Partial<{
  [P in keyof T]: ChainSetting<T, ArrayElementType<T[P]>>
}>

type SaveEventParam<T> = {
  entity: DeepPartial<T>;
  cloneEntity: DeepPartial<T>;
  dataBaseEntity?: T;
}
type SaveEvent<T> = {
  where: ( entity: DeepPartial<T> ) => boolean,
  beforeSave?: (param: Omit<SaveEventParam<T>, 'cloneEntity'>) => void;
  afterSave?: (param: SaveEventParam<T>) => void;
}
export type SaveSubscriber<T, P extends PathString<T>> = {
  details?: Array<P>;
  events: Array< SaveEvent<T> >
}

type DynamicSetPropertyOptionParam<P> = Array<P> | {
  details: Array<P>,
  data?: any
}

export abstract class ChainRepository<T, P extends PathString<T> = PathString<T>> extends Repository<T> {
  public abstract readonly primaryKeys: Array<keyof T>;
  public abstract readonly alias: string;
  public abstract readonly relationChain: ChainRelation<T>|undefined;
  public abstract readonly setPropertySubscriber: Array<SetPropertyEvent<T, P>>|undefined;
  public abstract readonly saveSubscribe: SaveSubscriber<T, P>|undefined;

  async getOne( 
    queryBuilder: (self: ChainRepository<T, P>) => SelectQueryBuilder<T>,
    detailsOrOption: DynamicSetPropertyOptionParam<P>
  ): Promise<T> {
    return this.getMany(queryBuilder, detailsOrOption)
      .then(rst => rst.length > 0 ? rst[0] : undefined)
  }

  async getMany(  
    queryBuilder: (self: ChainRepository<T, P>) => SelectQueryBuilder<T>,
    detailsOrOption: DynamicSetPropertyOptionParam<P>
  ): Promise<Array<T>>{
    // const self = this;
    return queryBuilder(this)
    .getMany()
    .then(rst => this
      .setProperty(detailsOrOption, rst)
      .then( _ => rst)
    )
  }

  setProperty( detailsOrOption: DynamicSetPropertyOptionParam<P>, entities: Array<T> ): Promise<Array<T>>;
  setProperty<D>( detailsOrOption: DynamicSetPropertyOptionParam<P>, entities: Array<D>, relation: Relation<T, D> ): Promise<Array<D>>;
  async setProperty( 
    detailsOrOption: DynamicSetPropertyOptionParam<P>, entities: Array<any>, relation?: Relation<T, any>
  ): Promise<Array<any>> {
    
    const option: {details: Array<P>, data?: any} = (Array.isArray(detailsOrOption) ? { details: detailsOrOption } : detailsOrOption);
    const details = option?.details;

    if( 
      !details 
      || entities.filter( item => !!item ).length === 0
    )
      return entities;

    if( relation ){
      const pks: Record<keyof T, Array<any>> = getIdsRecord(
        relation.bridges.map( ({inverse}) => inverse),
        this.primaryKeys
      )
      
      if( 
        entriesTypeGuard(pks)
        .filter( ([_, val]) => val.length === 0)
        .length === Object.keys(pks).length 
      )
        return entities;
  
      const query  = entriesTypeGuard(pks).filter( ([_, val]) => val.length > 0)
        .map( ([key]) => `${this.alias}.${String(key)} IN (:${String(key)})` )
        .join(' AND ')
      // console.log('[!!] relation', this.alias, query, pks)
      const fieldDatas: Array<T> = await this.createQueryBuilder(this.alias)
      .where(query, pks)
      .getMany();
  
      if( fieldDatas.length === 0 )
        return entities;
  
      setFieldRelation(entities, fieldDatas, relation);
      await this.chainingSetProperty( option, fieldDatas );
    }else{
      await this.chainingSetProperty( option, entities );
    }

    return entities;
  }

  private async chainingSetProperty(
    option: {details: Array<string>, data?: any}, 
    refreshments: Array<T>
  ): Promise<Array<any>> {
    if(!this.relationChain)
      return refreshments;

    const param = {
      entities: refreshments, 
      details: option.details as Array<P>, 
      data: option.data || {}
    };

    const beforeEvents = this.setPropertySubscriber?.filter( ({before, where}) => before && where(param))||[]
    if( beforeEvents.length > 0 )
      await Promise.all(
        beforeEvents.filter( ({before}) => before )
        .map( ({before}) => before(param) )
      )
    const subscriberEntity = initSetPropertySubscriber(param, this.setPropertySubscriber)
    param.details = subscriberEntity?.refreshDetails || param.details;

    const promises: Array<Promise<any>> = [];
    entriesTypeGuard(this.relationChain).forEach( ([key, val]) => {
      const startKey = String(key);
      if(param.details.find(path => (path as string) === key || path.startsWith(`${startKey}.`))){
        let paths = param.details.filter(path => path.startsWith(startKey))
          // .map(path => path.replace(new RegExp(`^${String(key)}.?`), ''))
          .filter(path => path);
        if( paths.length === 0 ) return;
        const startKeyNameReg = new RegExp(`^${startKey}.?`);
        paths = paths.map(path => path.replace(startKeyNameReg, ''))
          .filter(path => path) as Array<P>;
        if( val.Repository ){
          if( !(val.Repository.prototype instanceof ChainRepository) )
            return
          
          const { getBridges, fieldIsMany } = val;
          const repo = (new (val.Repository as any)(val.Entity, this.manager, this.manager.queryRunner) as ChainRepository<never>);
          promises.push(
            getBridges({entityManager: this.manager, selfEntities: param.entities})
            .then( bridges => 
              repo.setProperty({details: paths, data: option.data}, param.entities, {
                fieldIsMany,
                fieldName: key as never,
                bridges: bridges as unknown as any
              })
            )
          )
        }else {
          if( !('getDatas' in val) )
            return;
          const { fieldIsMany } = val;
          const bridgesPromise = (val as NotExistChainRepository<unknown, unknown>).getBridges({
            entityManager: this.manager, 
            selfEntities: param.entities
          });
          const dataPromise = (val as NotExistChainRepository<unknown, unknown>).getDatas({
            entityManager: this.manager,
            selfEntities: param.entities,
            details: paths as [], 
            bridgesPromise,
          })

          promises.push(
            Promise.all([ bridgesPromise, dataPromise ])
            .then( ([bridges, data]) => {
              if(bridges.length > 0 && data.length > 0)
                setFieldRelation(param.entities, data as any, {bridges, fieldIsMany, fieldName: key})
            })
          )
        }
      }


    })

    return Promise.all(promises).then( async _ => {
      if( subscriberEntity ){
        const afterEvents = this.setPropertySubscriber.filter( ({after, where}) => after && where(param))||[];
        if( afterEvents.length > 0 )
          await Promise.all(
            afterEvents.filter( ({after}) => after )
            .map( ({after}) => after(param) )
          )
        
        removeDeepEntity(param.entities, subscriberEntity.willRemoves);
      }

      return param.entities
    });
  }


  save<D extends DeepPartial<T>>(entities: D[], options: SaveOptions & { reload: false; }): Promise<D[]>;
  save<D extends DeepPartial<T>>(entities: D[], options?: SaveOptions): Promise<(D & T)[]>;
  save<D extends DeepPartial<T>>(entity: D, options: SaveOptions & { reload: false; }): Promise<T>;
  save<D extends DeepPartial<T>>(entity: D, options?: SaveOptions): Promise<D & T>;
  async save<D extends DeepPartial<T>>(entityOrEntities: D|D[], options?: any): Promise<T|T[]> {
    const entities: Array<D> = Array.isArray(entityOrEntities) ? entityOrEntities : [ entityOrEntities ];
    const saveEventFlag = this.saveSubscribe 
    ? entities.some( 
        entity => this.saveSubscribe.events.some( event => event.where(entity) ) 
      )
    : false
    // const details: Array<P> = [];
    if( saveEventFlag ){
      const { beforeEvents, afterEvents } = filterEventFromSaveSubscribe(this.saveSubscribe, entities)

      if( beforeEvents.length > 0 ){
        const pks = getIdsRecord(entities, this.primaryKeys as any);
        const databaseEntities = await getDataBaseEntities(this as any, pks) as T[]

        await Promise.all(
          beforeEvents.map( ({action, entity}) => 
            action({
              entity, 
              dataBaseEntity: findDataBaseEntity(databaseEntities, entity, this.primaryKeys)
            })
          )
        )

      }
  
      return super.save(entityOrEntities as any, options)
      .then( async resultEntityOrEntities => {
  
        if( afterEvents.length > 0 ){
          const pks = getIdsRecord(entities, this.primaryKeys as any);
          const databaseEntities = await getDataBaseEntities(this as any, pks) as T[]
          await Promise.all(
            afterEvents.map( ({action, entity, cloneEntity}) => 
              action({
                entity, cloneEntity,
                dataBaseEntity: findDataBaseEntity(databaseEntities, entity, this.primaryKeys)
              })
            )
          )
        }

        return resultEntityOrEntities as any;
      } );

    }else
      return super.save(entityOrEntities as any, options) as any;
  }
}


type FilterBeforeEvent<T> = {
  entity: DeepPartial<T>;
  action: (param: Omit<SaveEventParam<T>, 'cloneEntity'>) => void;
}
type FilterAfterEvent<T> = {
  entity: DeepPartial<T>;
  cloneEntity: DeepPartial<T>;
  action: (param: SaveEventParam<T>) => void;
}
const filterEventFromSaveSubscribe = <T, P extends PathString<T>> (
  saveSubscribe: SaveSubscriber<T, P> ,  entities: Array<DeepPartial<T>>
): {beforeEvents: Array<FilterBeforeEvent<T>>, afterEvents: Array<FilterAfterEvent<T>> } => entities.reduce( ( result, entity ) => {
    saveSubscribe.events.forEach( event  => {
      if( event.where(entity) ){
        if( event.beforeSave ){
          result.beforeEvents.push({
            entity, 
            action: event.beforeSave
          })
        }
        if( event.afterSave ){
          result.afterEvents.push({
            entity, cloneEntity: deepClone(entity),
            action: event.afterSave
          })
        }
      }
    })
    return result;
  }, { beforeEvents: [] , afterEvents: []})

const getDataBaseEntities = async <T>(
  chainRepository: ChainRepository<T>,
  pks: Record<keyof T, Array<any>>
): Promise<Array<T>> => 
  !entriesTypeGuard(pks).some( ([, val]) => val.length === 0)
  ? chainRepository.getMany(
    ctx => ctx.createQueryBuilder(ctx.alias)
    .where(
      entriesTypeGuard(pks)
      .map( ([key]) => `${ctx.alias}.${String(key)} IN (:${String(key)})` )
      .join(' AND '), 
      pks
    ),
    chainRepository.saveSubscribe?.details
  )
: []

const findDataBaseEntity = <T>(
  databaseEntities: Array<T>,
  entity: DeepPartial<T>,
  primaryKeys: Array<keyof T>
): T => primaryKeys.some( key => !entity[key as string] ) 
  ? undefined
  : databaseEntities.find( 
      databaseEntity => 
        isContains( databaseEntity, getPick(entity, primaryKeys as any) )
    )

type InitSetPropertySubscriber<T, P> = {
  refreshDetails: Array<P>;
  willRemoves: Array<P>;
  // subscribers: Array<SetPropertyEvent<T, P>>;
}
const initSetPropertySubscriber = <T, P extends string>( 
  setPropertyParam: ChainSetPropertyParam<T, P>,  subscriber: Array<SetPropertyEvent<T, P>> 
): InitSetPropertySubscriber<T, P> => {
  // console.log('[!!!!] initSetPropertySubscriber START')
  if( !setPropertyParam || !subscriber || subscriber.length === 0 )
    return undefined;

  const filter = subscriber.filter( ({ where, before, after }) => (before || after) && where(setPropertyParam) );
  if( filter.length === 0 )
    return undefined;
    
  const reqCompre = stringToArrayFilterDuplicate(setPropertyParam.details);
  const refreshDetails: Array<Array<string>> = stringToArrayFilterDuplicate(
    filter.filter( ({details}) => details?.length > 0 )
    .map( ({details}) => details )
    .reduce( (rst, details) => {
      details.forEach( detail => {
        if( detail !== '' && !rst.includes(detail) )
          rst.push(detail)
      })
      return rst
    }, [] as Array<string>), 
    deepClone(reqCompre)
  );
  
  const willRemoves: Array<P> = refreshDetails.reduce( (rst, detailParts) => {
    const { sameIndex } = detailParts.reduce( (partRst, part, i) => {
      if( i !== 0 && partRst.sameIndex === -1 )
        return partRst;
      // console.log(`[SAME_INDEX] ${detailParts} ${part}`, partRst);
      const sameReq = partRst.compare.filter( reqPart => reqPart[i] === part);
      partRst.compare = sameReq;
      if( sameReq.length > 0 )
        partRst.sameIndex = i;

      return partRst;
    }, { sameIndex: -1, compare: reqCompre})

    if( detailParts.length !== sameIndex + 1 ){
      const willRemoveKey = detailParts.slice(0, sameIndex + 2).join('.');
      if( !rst.some( exist => exist === willRemoveKey) )
        rst.push(willRemoveKey);
    }
    return rst;
  }, [] as Array<any>)

  // console.log('[CLIENT_DETAILS]', reqCompre )
  // console.log('[REFRESH_DETAILS]', refreshDetails )
  // console.log('[WILL_REMOVES]', willRemoves )
  // console.log('[!!!!] initSetPropertySubscriber E N D')
  
  return {
    refreshDetails: refreshDetails.map( detailParts => detailParts.join('.') ) as Array<P>,
    willRemoves,
    // subscribers: filter,
  }

  

}

const removeDeepEntity = <T, P extends PathString<T>>(entities: Array<T>, removeDetails: Array<P>) => {
  if( entities?.length > 0 && removeDetails?.length > 0 )
    entities?.forEach( entity => {
      removeDetails.forEach( detail => {
        
        if( detail.indexOf('.' ) > 1 ){
          const beforeFieldAbstractKey = detail.substring(0, detail.indexOf('.') ) as PathString<ArrayElementType<T>>
          const fieldName = detail.substring( beforeFieldAbstractKey.length + 1 )
          deepSelectFlatMap(entity,  beforeFieldAbstractKey, 
            (select) => select.field[fieldName] = undefined
          )
          
        }else{
          const fieldName = detail as unknown as keyof T;
          if( entity[fieldName] )
            entity[fieldName] = undefined;
        }
        
      })
    })
}

const stringToArrayFilterDuplicate = ( details: Array<string>, init: Array<Array<string>> = [] ): Array<Array<string>> => {
  return details.map( detail => detail.split('.') )
  .filter( detailParts => !detailParts.some( part => isUndeclared(part) || isBlank(part) ) )
  .reduce( (rst, detailParts ) => {
    const sameInfo = detailParts.reduce( (partRst, part, i) => {
      if( i !== 0 && partRst.sameIndex === -1 )
        return partRst;

      const sameReq = partRst.compare.filter( reqPart => reqPart[i] === part);
      partRst.compare = sameReq;
      if( sameReq.length > 0 ){
        partRst.sameIndex = i;
        partRst.lastSameCompare = sameReq;
      }

      return partRst;
    }, { sameIndex: -1, compare: rst, lastSameCompare: []});

    // if( type === 'a' ){
    //   console.log(`[SAME_INDEX] ${detailParts} START`);
    //   console.log( sameInfo, rst )
    // }

    if( sameInfo.sameIndex === -1 ){
      // if( type === 'a' )
      //   console.log('IF', detailParts)
      rst.push(detailParts)
    } else {
      const requestAdds = sameInfo.lastSameCompare.filter( comp => (comp.length - 1) === sameInfo.sameIndex );
      if( requestAdds.length > 0){
        const add = detailParts.slice( sameInfo.sameIndex+1 );
        // if( type === 'a' )
        //   console.log('ELSE IF 원래 있는것에 추가', add)
        requestAdds.forEach( requestAdd => 
          requestAdd.splice(requestAdd.length, 0, ...add)
        )
      }else if( sameInfo.sameIndex === (detailParts.length-1) ){
        // if( type === 'a' )
        //   console.log('ELSE IF 아무것도 안함', detailParts)
        // return rst;
      }else{
        // if( type === 'a' )
        //   console.log('ELSE 새롭게 추가', detailParts)
        rst.push(detailParts)
      }
    }
    
    // if( type === 'a' ){
    //   console.log( sameInfo, rst )
    //   console.log(`[SAME_INDEX] ${detailParts} E N D`);
    // }
    return rst;
  }, init )

}

const REFLECT_KEY = 'ENTITY';
export const createChainRepository = <
  T extends ObjectLiteral, P extends PathString<T>, R extends ChainRepository<T, P>
>(
  target: ObjectType<T>, 
  {
    primaryKeys,
    alias,
    relationChain,
    setPropertySubscriber,
    saveSubscribe
  }: { 
    primaryKeys: Array<keyof T>;
    alias: string;
    relationChain: ChainRelation<T>;
    setPropertySubscriber?: Array<SetPropertyEvent<T, PathString<T>>>;
    saveSubscribe?: SaveSubscriber<T, PathString<T>>;
  }
): new (target: ObjectType<T>, manager: EntityManager, queryRunner?: QueryRunner) => R => {
  const dynamicCls = class DynamicChainRepository extends ChainRepository<T, P> {
    public primaryKeys: Array<keyof T> = primaryKeys;
    public alias: string = alias;
    public relationChain: ChainRelation<T>|undefined = relationChain;
    public setPropertySubscriber: Array<SetPropertyEvent<T, P>>|undefined = setPropertySubscriber as any;
    public saveSubscribe: SaveSubscriber<T, P>|undefined = saveSubscribe as any;
  }

  setReflectProperty(target, dynamicCls, REFLECT_KEY)

  return dynamicCls as any;
}
  

type DynamicRepository<T> = T extends Repository<any> 
  ? T 
  : ChainRepository<T>
type ConvertRepositories<T> = {
  [P in keyof T]: DynamicRepository<T[P]>
}
export const getChainRepositories = <T>(
  repositories: {[P in keyof T]: ObjectType<T[P]>}, entityManager: EntityManager
): ConvertRepositories<T> => {
  if( !entityManager )
    return {} as ConvertRepositories<T>;

  return entriesTypeGuard(repositories).reduce( (result, [key, val]) => {
    // console.log(`${key} is extends Repository?`, val.prototype instanceof Repository, val);
    if(val.prototype instanceof ChainRepository ){
      const Entity = getReflectProperty(val, REFLECT_KEY);
      if( Entity )
        result[key] = new (val as any)(Entity, entityManager, entityManager.queryRunner) as DynamicRepository<T[keyof T]>
    }else
      result[key] = entityManager.getRepository(val) as DynamicRepository<T[keyof T]>
    return result;
  }, {} as ConvertRepositories<T>)
}
