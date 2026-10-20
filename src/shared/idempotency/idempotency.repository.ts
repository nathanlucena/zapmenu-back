export interface IdempotencyRepository {
  jaProcessado(origem: string, chaveExterna: string): Promise<boolean>;
  marcarProcessado(origem: string, chaveExterna: string): Promise<void>;
}
