import { UnionToIntersection } from './utils'

export const EFFECT_NAME: unique symbol = Symbol.for('hyogwa/effect-name')

/**
 * This type has two different meaning:
 * 1. Base type for effect specification types
 * 2. Type of Types which includes every possible effect specification types (i.e. Kind of effect specification types)
 *
 * (second one is possible thanks to subtype polymorphism)
 */
export interface Spec<N extends string = string> {
  [EFFECT_NAME]: N
}

/**
 * Type of Actions(Effectful terms/codes/operations)
 *
 * Parameterized by name of the effect where the action belongs('EN'), name of the action constructor('CN')
 * and type of parameters the action requires('P')
 */
export interface Action<EN, CN, P> {
  effectName: EN
  constructorName: CN
  parameters: P
}

type PickActionNames<S extends Spec> = Exclude<keyof S, typeof EFFECT_NAME>

/**
 * Produce action types from given effect(specification)
 */
type ActionFromSpec<S extends Spec>
  = PickActionNames<S> extends infer K ?
      K extends keyof S ?
        Action<S[typeof EFFECT_NAME], K, S[K] extends (...args: infer P) => unknown ? P : never>
        : never
      : never

/** ActionFromSpec iterating over union of specs */
type ActionsFromSpecs<S extends Spec>
  = S extends infer S_ ?
      S_ extends Spec ?
        ActionFromSpec<S_>
        : never
      : never

/**
 * Type of effectful computation
 *
 * Parameterized by spec of effects('S') and evaluation result type('R').
 * It's possible to provide multiple effect spec by combining specs via union.
 *
 * Theoretically, Effectful computation is Generator object that...
 *
 * 1. May yield arbitrary number of actions.
 * 2. Must return computation result of type 'R' as return value.
 */
export interface Effectful<S extends Spec, R> extends Generator<ActionsFromSpecs<S>, R> {
  [Symbol.iterator](): Effectful<S, R>
}

/**
 * Type of Effect
 *
 * Takes an effect spec and returns actual representation of that effect
 */
type Effect<S extends Spec> = {
  [K in PickActionNames<S>]: S[K] extends (...args: infer P) => infer R ? (...args: P) => Effectful<S, R> : Effectful<S, S[K]>
}

/**
 * Type utility for deriving new effect from another
 */
export type Derive<N extends string, S extends Spec> = Omit<S, typeof EFFECT_NAME> & { [EFFECT_NAME]: `${N}` }

/**
 * Effect constructor
 *
 * Given an effect specification as type argument and an effect name as actual argument,
 * returns an actual effect representation. Actual effect representation contains action constructors.
 */
export function createEffect<S extends Spec>(effectName: S[typeof EFFECT_NAME]): Effect<S> {
  return new Proxy({}, {
    // Property accesses which have passed type check are always access to action creators
    get(_, constructorName) {
      // Action creator for function effects
      //@ts-ignore-next-line
      const result = function* (...parameters) {
        //@ts-ignore-next-line
        return yield { effectName, constructorName, parameters }
      }

      // Action creator for value effects
      //@ts-ignore-next-line
      result[Symbol.iterator] = function* () {
        //@ts-ignore-next-line
        return yield { effectName, constructorName }
      }

      return result
    }
  }) as Effect<S>
}
//@TODO: make this function only require spec of new effect

/**
 * Interface for handle tactics
 *
 * Parameterized by type of the effect evaluation result('ER') and type of the handle abortion value('R')
 * if 'abort' is never used in actual implementation, you may pass 'never' as 'R'.
 *
 * short description:
 *  'ER' for type of value which will be passed to original context
 *  'R' for type of value which will be used as result of 'handle' call
 */
interface HandleTactics<in ER, in R> {
  resume(value: ER): void
  abort(value: R): void
}

/**
 * Produce handler type definition for given effect(specification)
 *
 * Type parameter 'R' is type of effect handle's result(note that this is not type of action handle's result)
 *
 * WARNING: This type must be used with 'satisfy' operator or used as constraint on type variable.
 * Do not directly annotate handlers as this type.
 */
type HandlerFromSpec<S extends Spec, R> = {
  [K in PickActionNames<S>]:
    S[K] extends (...args: infer P) => infer ER ?
      (...args: [...P, HandleTactics<ER, R>]) => void | Effectful<Spec, void>
      : S[K] | Effectful<Spec, S[K]>
}
/** it's okay to leave place of effect with most general type 'Spec'
 * using type variable and inference smart will care your concern
 * ref: 'handle' function
 */

/** HandlerFromSpec iterating over union of specs */
type HandlersFromSpecs<S extends Spec, R>
  = UnionToIntersection<
  S extends infer S_ ?
    S_ extends Spec ?
      { [K in S_[typeof EFFECT_NAME]]: HandlerFromSpec<S, R> }
      : never
    : never
>

/**
 * Produce handler type definition for given effect(specification)
 *
 * Type parameter 'R' is type of effect handle's result(note that this is not type of action handle's result)
 *
 * WARNING: This type must be used with 'satisfy' operator or used as constraint on type variable.
 * Do not directly annotate handlers as this type.
 */
export type Handlers<S extends Spec, R = never> = HandlersFromSpecs<S, R>

/**
 * Collects used effects from given handler(type)
 */
export type CollectEffectsFromHandlers<H>
  = keyof H extends infer K1 ?
      K1 extends keyof H ?
        keyof H[K1] extends infer K2 ?
          K2 extends keyof H[K1] ?
            H[K1][K2] extends () => Effectful<infer E, unknown> ?
              E
              : H[K1][K2] extends Effectful<infer E, unknown> ?
                  E
                  : never
            : never
          : never
        : never
      : never

export class HandleError extends Error {
  constructor(action: Action<string, string, unknown[]>, reason: string) {
    super(`
      Fail to handle action '${action.effectName}.${action.constructorName}'\n${reason}
    `.trim());
  }
}

function* _handle<E extends Spec, R, H extends Partial<Handlers<E, R>>>(computation: Effectful<E, R>, handlers: H)
// those were type of parameters, following is return type
  : Effectful<Exclude<E, { [EFFECT_NAME]: keyof H }> | CollectEffectsFromHandlers<H>, R> {
  let thrown = computation.next()
  let isPreviousEffectResolved = true
  let aborted = false
  let abortedValue

  while (!thrown.done && isPreviousEffectResolved && !aborted) {
    const action = thrown.value
    isPreviousEffectResolved = false

    // @ts-ignore-next-line
    if (action.effectName in handlers && action.constructorName in handlers[action.effectName]) {
      // handle value effects
      // @ts-ignore-next-line
      if (typeof handlers[action.effectName][action.constructorName] !== 'function') {
        // @ts-ignore-next-line
        thrown = computation.next(handlers[action.effectName][action.constructorName])
        isPreviousEffectResolved = true
      } else {
        // handle operational effects
        // @ts-ignore-next-line
        const maybeComputation = handlers[action.effectName][action.constructorName](
          // @ts-ignore-next-line
          ...action.parameters,
          {
            // @ts-ignore-next-line
            resume(value) {
              if (isPreviousEffectResolved) throw new HandleError(action, 'cannot call handle tactics more than once')
              thrown = computation.next(value)
              isPreviousEffectResolved = true
            },
            // @ts-ignore-next-line
            abort(value) {
              if (isPreviousEffectResolved) throw new HandleError(action, 'cannot call handle tactics more than once')
              // mark effect handling process is aborted and save return value
              abortedValue = value
              isPreviousEffectResolved = true
              aborted = true
            }
          })

        // handle handlers which produce more effects
        if (typeof maybeComputation?.[Symbol.iterator] === 'function')
          // @ts-ignore-next-line
          yield* maybeComputation
      }
    } else {
      // case when handler for given action is not exist
      thrown = computation.next(yield action)
      isPreviousEffectResolved = true
    }
  }

  if (!isPreviousEffectResolved)
    throw new HandleError(thrown.value as Action<string, string, unknown[]>, 'Effect handlers must call handle tactics')

  return aborted ? abortedValue! : thrown.value
}

/**
 * Resolves some effects of given computation by attaching handlers
 *
 * Handlers must handle effects with handle tactics(ex: 'resume') before they return something
 * Assumption: given computation must be 'fresh' one (i.e. the one never executed after creation)
 *
 * To find actual implementation, see 'handle_' function.
 */
export function handle<E extends Spec, R, H extends Partial<Handlers<E, R>>>(computation: Effectful<E, R>, handlers: H)
  : Effectful<Exclude<E, { [EFFECT_NAME]: keyof H }> | CollectEffectsFromHandlers<H>, R>
export function handle<E extends Spec, R, H extends Partial<Handlers<E, R>>>(handlers: H, computation: Effectful<E, R>)
  : Effectful<Exclude<E, { [EFFECT_NAME]: keyof H }> | CollectEffectsFromHandlers<H>, R>
export function handle<E extends Spec, R, H extends Partial<Handlers<E, R>>>(handlers: H, computation: () => Effectful<E, R>)
  : Effectful<Exclude<E, { [EFFECT_NAME]: keyof H }> | CollectEffectsFromHandlers<H>, R>
export function handle<E extends Spec, R, H extends Partial<Handlers<E, R>>>(first: Effectful<E, R> | H, second?: H | Effectful<E, R> | (() => Effectful<E, R>))
  : (Effectful<Exclude<E, { [EFFECT_NAME]: keyof H }> | CollectEffectsFromHandlers<H>, R>) {
  if (Symbol.iterator in first) return _handle<E, R, H>(first, second as H)
  else if (typeof second === 'function') return _handle<E, R, H>(second(), first)
  else return _handle<E, R, H>(second as Effectful<E, R>, first)
}