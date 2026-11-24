/** SHA-1 d’un blob Git : sha1("blob <taille>\0" + octets UTF-8). */
export async function shaBlobGit(contenu: string): Promise<string> {
  const octets = new TextEncoder().encode(contenu)
  const entete = new TextEncoder().encode(`blob ${octets.length}\0`)
  const tout = new Uint8Array(entete.length + octets.length)
  tout.set(entete)
  tout.set(octets, entete.length)
  const empreinte = await crypto.subtle.digest('SHA-1', tout)
  return [...new Uint8Array(empreinte)].map((o) => o.toString(16).padStart(2, '0')).join('')
}
