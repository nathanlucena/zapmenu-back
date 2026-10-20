import type { LojaParaPedidos } from '../orders/application/ports/loja-para-pedidos.js';
import type { MenuRepository } from './menu.repository.js';

/** As regras que a loja configurou pela gestão, vistas pelo módulo de pedidos. */
export function criarLojaParaPedidos(menuRepo: MenuRepository): LojaParaPedidos {
  return {
    regrasDe: (empreendedorId) => menuRepo.obterRegrasDePedido(empreendedorId),
  };
}
