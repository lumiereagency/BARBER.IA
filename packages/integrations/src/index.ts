// Integrações externas do BARBER.
//
// Vive num pacote próprio porque tem dois consumidores com papéis diferentes: o
// worker executa a sincronização, e a web mostra o estado e trata o OAuth.
// Deixar o código dentro de um dos dois faria o outro depender de uma aplicação.

export * from "./calendar/oauth.ts";
export * from "./calendar/provider.ts";
export * from "./calendar/sync.ts";
