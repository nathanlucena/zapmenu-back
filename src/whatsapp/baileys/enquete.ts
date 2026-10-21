import { createHash } from 'node:crypto';
import { decryptPollVote, type proto } from 'baileys';

/** O que é preciso guardar de uma enquete enviada para conseguir ler os votos depois. */
export interface EnqueteGuardada {
  id: string;
  /** messageSecret da enquete, em base64. */
  segredo: string;
  /** JID da conta que criou a enquete (o bot). */
  criadorJid: string;
  opcoes: string[];
}

/** Onde as enquetes enviadas ficam guardadas; no banco, sobrevivem a reinícios. */
export interface EnquetesStore {
  guardar(enquete: EnqueteGuardada): Promise<void>;
  buscar(id: string): Promise<EnqueteGuardada | null>;
}

export function criarEnquetesEmMemoria(): EnquetesStore {
  const enquetes = new Map<string, EnqueteGuardada>();
  return {
    async guardar(enquete) {
      enquetes.set(enquete.id, enquete);
    },
    async buscar(id) {
      return enquetes.get(id) ?? null;
    },
  };
}

function hashDaOpcao(opcao: string): string {
  return createHash('sha256').update(Buffer.from(opcao)).digest('hex');
}

/**
 * O voto chega cifrado com uma chave que depende do JID de quem criou e de
 * quem votou. Com o LID, o mesmo número tem dois JIDs, e não dá para saber de
 * antemão qual o WhatsApp usou: tenta as combinações até uma decifrar.
 * Devolve as opções marcadas, ou undefined se nenhuma combinação serviu.
 */
export function lerVoto(
  enquete: EnqueteGuardada,
  votoCifrado: proto.Message.IPollEncValue,
  candidatosCriador: string[],
  candidatosVotante: string[],
): string[] | undefined {
  const pollEncKey = Buffer.from(enquete.segredo, 'base64');
  for (const pollCreatorJid of new Set(candidatosCriador)) {
    for (const voterJid of new Set(candidatosVotante)) {
      let voto: proto.Message.PollVoteMessage;
      try {
        voto = decryptPollVote(votoCifrado, { pollCreatorJid, pollMsgId: enquete.id, pollEncKey, voterJid });
      } catch {
        continue;
      }
      const marcadas = new Set((voto.selectedOptions ?? []).map((hash) => Buffer.from(hash).toString('hex')));
      return enquete.opcoes.filter((opcao) => marcadas.has(hashDaOpcao(opcao)));
    }
  }
  return undefined;
}
