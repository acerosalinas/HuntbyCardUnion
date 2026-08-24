/** Pokémon TCG energy type - Pokémon-only, unlike rarity there's no One Piece equivalent, so this filter/field only ever appears in Pokémon contexts. */
export const POKEMON_TYPES = [
  "Normal",
  "Fire",
  "Water",
  "Grass",
  "Electric",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Steel",
  "Dark",
  "Fairy",
  "Stellar",
  "Shadow",
  "Typeless",
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];
