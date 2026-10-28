import { describe, expect, it } from 'vitest'
import { empty, some } from '@shared/maybe'
import { in_profile, profile_of } from '../../src/main/profile'

describe('profile_of', () => {
  it('is the default profile without the flag', () => {
    expect(profile_of(['/usr/bin/cocoa']).is_empty()).toBe(true)
  })

  // A packaged cocoa gets its arguments first; `electron-vite dev` passes
  // them after the entry it launches.
  it('reads the name in either form, wherever the flag is', () => {
    expect(profile_of(['/usr/bin/cocoa', '--profile', 'dev']).or_null()).toBe('dev')
    expect(profile_of(['electron', 'out/main/index.js', '--profile=dev']).or_null()).toBe('dev')
    expect(profile_of(['cocoa', '--no-sandbox', '--profile', 'try_2']).or_null()).toBe('try_2')
  })

  it('refuses a flag with no name', () => {
    expect(() => profile_of(['cocoa', '--profile'])).toThrow(/--profile needs a name/)
    expect(() => profile_of(['cocoa', '--profile='])).toThrow(/--profile needs a name/)
  })

  // The name becomes a directory and a socket file: nothing that climbs out
  // of either, and not the next flag taken for a name.
  it('refuses a name that cannot be a file name', () => {
    expect(() => profile_of(['cocoa', '--profile', '../elsewhere'])).toThrow(/got '..\/elsewhere'/)
    expect(() => profile_of(['cocoa', '--profile', '--no-sandbox'])).toThrow(/got '--no-sandbox'/)
  })
})

describe('in_profile', () => {
  it('keeps the name in the default profile and suffixes it in another', () => {
    expect(in_profile('cocoa', empty())).toBe('cocoa')
    expect(in_profile('/home/me/.config/cocoa', some('dev'))).toBe('/home/me/.config/cocoa-dev')
  })
})
