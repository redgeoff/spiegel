# Testing

## Beautify

We use [prettier](https://github.com/prettier/prettier) to beautify all of our code. This helps us to keep our coding style standardized. If the `lint` test fails, you'll want to run `npm run beautify` and then commit the changes.

## Test in node

This will run the tests in node:

    $ npm run node-test

You can also check for 100% code coverage using:

    $ npm run node-full-test

You can then view the test coverage by opening cache/coverage/node/lcov-report/index.html in a browser

Run specific tests:

    $ npm run node-test -- -g 'some reg-ex'

Run specific tests and generate code coverage:

    $ npm run node-full-test -- -g 'some reg-ex'

## Stress Test

This will run the stress tests, which are not run on CircleCI as they take a long time to run and would slow down the CI pipeline. Instead, these tests should be run periodically or after any major changes. These tests are designed to stress Spiegel and reveal bugs like those caused by race conditions.

    $ npm run stress-test
