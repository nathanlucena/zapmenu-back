import sharp, { type Sharp } from 'sharp';
import { LIMITE_DE_BYTES, TAMANHO_DA_CAPA, TAMANHO_DO_LOGO, type ImagensDaLoja } from './imagens-da-loja.js';

function paraBuffer(dataUri: string): Buffer {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}

/** JPEG baixando a qualidade até caber no limite (a partir de 82; não desce de 40). */
async function jpegQueCabe(imagem: Sharp): Promise<Buffer> {
  for (const qualidade of [82, 72, 62, 52, 40]) {
    const saida = await imagem.clone().jpeg({ quality: qualidade, mozjpeg: true }).toBuffer();
    if (saida.length < LIMITE_DE_BYTES || qualidade === 40) return saida;
  }
  throw new Error('inalcançável');
}

/**
 * Recorte e compressão com o sharp. A capa corta o centro de interesse da foto
 * (`attention`) em 3:1; o logo vira quadrado e mantém a transparência em PNG
 * quando cabe, senão vai em JPEG sobre fundo branco.
 */
export function criarImagensDaLojaSharp(): ImagensDaLoja {
  return {
    async prepararCapa(dataUri) {
      const imagem = sharp(paraBuffer(dataUri))
        .rotate()
        .resize(TAMANHO_DA_CAPA.largura, TAMANHO_DA_CAPA.altura, { fit: 'cover', position: sharp.strategy.attention });
      return `data:image/jpeg;base64,${(await jpegQueCabe(imagem)).toString('base64')}`;
    },
    async prepararLogo(dataUri) {
      const imagem = sharp(paraBuffer(dataUri))
        .rotate()
        .resize(TAMANHO_DO_LOGO.largura, TAMANHO_DO_LOGO.altura, { fit: 'cover' });
      const png = await imagem.clone().png({ compressionLevel: 9, palette: true }).toBuffer();
      if (png.length < LIMITE_DE_BYTES) {
        return `data:image/png;base64,${png.toString('base64')}`;
      }
      const semTransparencia = imagem.clone().flatten({ background: '#ffffff' });
      return `data:image/jpeg;base64,${(await jpegQueCabe(semTransparencia)).toString('base64')}`;
    },
  };
}
