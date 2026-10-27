import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LIMITE_DE_BYTES } from './imagens-da-loja.js';
import { criarImagensDaLojaSharp } from './imagens-da-loja.sharp.js';

/** Foto "real" de 3000×2000 com ruído (difícil de comprimir). */
async function fotoGrande(): Promise<string> {
  const largura = 3000;
  const altura = 2000;
  const pixels = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) % 256;
  const jpeg = await sharp(pixels, { raw: { width: largura, height: altura, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function bytesDe(dataUri: string): Buffer {
  return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

describe('capa e logo recortados e leves', () => {
  it('capa: 1200×400 em JPEG com menos de 300 KB', async () => {
    const capa = await criarImagensDaLojaSharp().prepararCapa(await fotoGrande());
    expect(capa.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta = await sharp(bytesDe(capa)).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 400]);
    expect(bytesDe(capa).length).toBeLessThan(LIMITE_DE_BYTES);
  });

  it('logo: quadrado 400×400 com menos de 300 KB', async () => {
    const logo = await criarImagensDaLojaSharp().prepararLogo(await fotoGrande());
    const meta = await sharp(bytesDe(logo)).metadata();
    expect([meta.width, meta.height]).toEqual([400, 400]);
    expect(bytesDe(logo).length).toBeLessThan(LIMITE_DE_BYTES);
  });
});
