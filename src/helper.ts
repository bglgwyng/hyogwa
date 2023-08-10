import { Spec, Action, Effectful, Handlers, EFFECT_NAME, CollectEffectsFromHandlers } from './core'

type Suggestion<M extends string, T = string> = M & T

export type InspectEffectfulFunction<G extends (...args: never) => Generator> =
 G extends (...args: never) => Generator<infer AS, infer R> ?
    [AS] extends [Action<string, string, unknown[]>] ?
      Suggestion<
        'We have inferred effects used in the function and return type of the function. Consider typing the function properly with this information.',
        {
          'name of effects used in the function': AS extends Action<infer N, string, unknown[]> ? N : never
          'return type of the function': R
        }
      >
      : Suggestion<
        'Effectful functions must be generator functions which only yields actions(effectful terms) but found value of this type can be yield in the given function',
        {
          'non action type': Exclude<AS, Action<string, string, unknown[]>>
        }
      >
    : Suggestion<'Fail to extract type level information of given function'>

export type InspectEffectHandling<C extends Effectful<Spec, unknown>, H> =
  C extends Effectful<infer SS, infer R> ?
    string extends (SS extends Spec<infer N> ? N : never) ?
      Suggestion<'Malformed spec is found, every specs must have their name as string literal type. But spec of given computation has \'string\' type as its name'>
      : H extends Partial<Handlers<SS, R>> ?
        Suggestion<
          'We have inspected handling of the computation via the given handler',
          {
            'effects resolved by handling': keyof H
            'effects remain after handling': Exclude<SS, { [EFFECT_NAME]: keyof H }> |  CollectEffectsFromHandlers<H>
            'result of handling': R
          }
        >
        : Handlers<SS, R> extends infer OH ?
          keyof OH extends infer ENS ?
            ENS extends infer EN extends keyof OH ?
              EN extends keyof H ?
                keyof OH[EN] extends infer ANS ?
                  ANS extends infer AN extends keyof OH[EN] ?
                    AN extends keyof H[EN] ?
                      H[EN][AN] extends OH[EN][AN] ?
                        never
                        : Suggestion<
                          'Type mismatch found in action handler',
                          {
                            'we expected action handler to be(or subtype of this)': OH[EN][AN]
                            'but we got': H[EN][AN]
                          }
                        >
                      : Suggestion<
                        'Absence of required action handler is found',
                        {
                          'name of missing handler': AN,
                          'type of missing handler': OH[EN][AN]
                        }
                      >
                    : never
                  : never
                : never
              : never
            : never
          : never
    : Suggestion<'Fail to extract effect specifications or result type from the given effectful computation'>

