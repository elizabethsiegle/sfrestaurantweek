const MENU_ID = /menu_id:\s*'(\d+)'/
const ACCOUNT = 'SF_RESTAURANT_WEEK'

export function parseMenuIdFromViewer(html: string): string | null {
  return MENU_ID.exec(html)?.[1] ?? null
}

export function viewerUrl(podId: string): string {
  return `https://www.menumodo.com/app.php/viewer/index/${podId}`
}

export function printUrl(menuId: string): string {
  return `https://www.menumodo.com/app.php/menu/html_print/${menuId}/${ACCOUNT}`
}
