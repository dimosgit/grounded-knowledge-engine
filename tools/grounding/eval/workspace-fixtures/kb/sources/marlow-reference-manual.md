---
title: Marlow reference manual
tags: [marlow, reference]
---

# Marlow reference manual

Marlow routes each request through a chain of handlers. Request handling starts
when the dispatcher picks the first of the registered handlers, and a request
counts as handled once a handler-less fallback has run or the chain ends.

## Handling errors

Errors raised while handling a request go to the error handlers in order. The
eventhandlers registered at start-up see every request that was handled, and
the logging handlers record how long the handling took.

## Methodology

The Marlow methodology is methodical: each of the handlers owns one concern, and
handling is kept free of side effects. Teams that follow the methodology
methodically find that handled requests are easy to replay.

## Configuring handlers

Handlers are configured in marlow.yaml. The handling order follows the file, and
handlers that are switched off are skipped while handling continues.
