export const appLibrary=page=>page.getByRole('dialog',{name:'App library',exact:true});
export async function showAppLibrary(page){
  if(!await appLibrary(page).isVisible())await page.getByRole('button',{name:'App library',exact:true}).click();
  return appLibrary(page);
}
export const libraryApp=(page,name)=>appLibrary(page).locator('.addon-row').filter({has:page.getByRole('button',{name:`Open ${name}`,exact:true})});
export async function openLibraryApp(page,name){await showAppLibrary(page);await appLibrary(page).getByRole('button',{name:`Open ${name}`,exact:true}).click();}
