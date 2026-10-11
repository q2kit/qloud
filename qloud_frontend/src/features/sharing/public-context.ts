import { createContext, useContext } from 'react';

/** Scope every preview and thumbnail request to the public link, including signed-in visitors. */
export const PublicTokenContext = createContext<string | undefined>(undefined);
export const usePublicToken = () => useContext(PublicTokenContext);
