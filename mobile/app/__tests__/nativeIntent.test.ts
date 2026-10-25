import { redirectSystemPath } from '../app/+native-intent';

describe('redirectSystemPath', () => {
  it('přepíše App Link /qes/sign na routu /sign', () => {
    expect(
      redirectSystemPath({ path: 'https://dokulachtan.fly.dev/qes/sign?token=abc', initial: true }),
    ).toBe('/sign?token=abc');
  });

  it('přepíše App Link /qes/app na routu /', () => {
    expect(
      redirectSystemPath({ path: 'https://dokulachtan.fly.dev/qes/app?token=abc', initial: false }),
    ).toBe('/?token=abc');
  });

  it('nechá custom scheme beze změny', () => {
    expect(redirectSystemPath({ path: 'dokulachtan://sign?token=abc', initial: true })).toBe(
      'dokulachtan://sign?token=abc',
    );
  });

  it('nechá ostatní odkazy beze změny', () => {
    expect(redirectSystemPath({ path: 'https://dokulachtan.fly.dev/s/abc', initial: true })).toBe(
      'https://dokulachtan.fly.dev/s/abc',
    );
  });
});
