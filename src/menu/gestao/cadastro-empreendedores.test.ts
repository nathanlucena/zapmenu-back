import { describe, expect, it } from 'vitest';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';

describe('criarCadastroPorLista', () => {
  it('libera um telefone da lista, com ou sem o nono dígito', async () => {
    const cadastro = criarCadastroPorLista(['5581999990000']);

    expect(await cadastro.empreendedorIdDoTelefone('5581999990000')).toBe('5581999990000');
    expect(await cadastro.empreendedorIdDoTelefone('558199990000')).toBe('558199990000');
  });

  it('recusa telefone fora da lista', async () => {
    const cadastro = criarCadastroPorLista(['5581999990000']);

    expect(await cadastro.empreendedorIdDoTelefone('5511988887777')).toBeNull();
  });

  it('com a lista vazia libera qualquer número', async () => {
    const cadastro = criarCadastroPorLista([]);

    expect(await cadastro.empreendedorIdDoTelefone('5511988887777')).toBe('5511988887777');
  });
});
