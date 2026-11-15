import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supplementalStrings } from "@/i18n/strings";
import K6TestWizard from "./K6TestWizard";

const apiMock=vi.hoisted(()=>({getClusters:vi.fn(),getTemplates:vi.fn(),getRunDefaults:vi.fn(),getNamespaces:vi.fn(),listFiles:vi.fn(),resolveClusterImage:vi.fn(),createCRD:vi.fn()}));
vi.mock("@/services/api",()=>({api:apiMock}));
vi.mock("@/components/PreferencesContext",()=>({usePreferences:()=>({lang:"fr",t:(key:string)=>supplementalStrings.fr[key as keyof typeof supplementalStrings.fr] || key})}));
vi.mock("@/components/K6ScriptEditor",()=>({default:()=>null}));
vi.mock("@/components/guardian/PreflightPanel",()=>({default:({open,onProceed}:{open:boolean;onProceed:(id:string)=>void})=>open?<button onClick={()=>onProceed("validation-test")}>Valider le lancement</button>:null}));
afterEach(cleanup);
beforeEach(()=>{
 const values = new Map<string, string>();
 vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
 localStorage.clear();localStorage.setItem("username","alice");localStorage.setItem("active_workspace_id","default");vi.clearAllMocks();
 apiMock.getClusters.mockResolvedValue([{id:"c1",name:"Cluster A",k6_operator_installed:true}]);apiMock.getTemplates.mockResolvedValue([]);apiMock.getNamespaces.mockResolvedValue(["qa"]);apiMock.listFiles.mockResolvedValue([]);
 apiMock.getRunDefaults.mockResolvedValue({env_vars:[],output_args:"",use_output:false,use_image:false,image_url:""});
 apiMock.resolveClusterImage.mockImplementation(async (_id:string,image:string)=>image);
 apiMock.createCRD.mockImplementation(async (_id:string,_ns:string,body:{name:string})=>({metadata:{name:body.name}}));
});
async function start(){
 fireEvent.click(await screen.findByRole("button",{name:/Créer un test HTTP/}));
 await waitFor(()=>expect((screen.getByLabelText("Namespace") as HTMLSelectElement).value).toBe("qa"));
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
}
it("launches a guided request with thresholds, telemetry tags and Secret references after Guardian",async()=>{
 const created=vi.fn();render(<K6TestWizard open advancedMode={false} onClose={()=>{}} onCreated={created}/>);
 await start();
 fireEvent.change(screen.getByLabelText("URL cible"),{target:{value:"https://example.test/api"}});
 fireEvent.change(screen.getByLabelText("Authentification"),{target:{value:"bearer"}});
 fireEvent.change(screen.getByLabelText("Nom du Secret"),{target:{value:"api-auth"}});
 fireEvent.change(screen.getByLabelText("Utilisateurs virtuels"),{target:{value:"25"}});
 for(let i=0;i<3;i++)fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
 expect(apiMock.createCRD).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Confirmer"}));
 fireEvent.click(await screen.findByRole("button",{name:"Valider le lancement"}));
 await waitFor(()=>expect(created).toHaveBeenCalledOnce());
 const [cluster,namespace,payload]=apiMock.createCRD.mock.calls[0];
 expect(cluster).toBe("c1");expect(namespace).toBe("qa");expect(payload.validation_run_id).toBe("validation-test");
 expect(payload.scriptContent).toContain('"vus": 25');expect(payload.scriptContent).toContain('p(95)<500');expect(payload.scriptContent).toContain('"cluster": "c1"');
 expect(payload.spec.runner.env).toContainEqual({name:"STRATOS_BEARER_TOKEN",valueFrom:{secretKeyRef:{name:"api-auth",key:"token"}}});
 expect(payload.name).toMatch(/^http-test-/);
});
it("restores a guided draft and rejects an invalid target before proceeding",async()=>{
 const props={open:true,advancedMode:false,onClose:()=>{},onCreated:()=>{}};
 const view=render(<K6TestWizard {...props}/>);await start();
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));expect(screen.getByRole("alert").textContent).toContain("Vérifiez l’URL");
 fireEvent.change(screen.getByLabelText("URL cible"),{target:{value:"https://example.test/api?token=private"}});
 fireEvent.click(screen.getByRole("button",{name:"Enregistrer le brouillon"}));view.unmount();
 render(<K6TestWizard {...props}/>);await screen.findByRole("button",{name:/Créer un test HTTP/});
 fireEvent.click(screen.getByRole("button",{name:"Reprendre le brouillon"}));
 await waitFor(()=>expect((screen.getByLabelText("Namespace") as HTMLSelectElement).value).toBe("qa"));
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));expect((screen.getByLabelText("URL cible") as HTMLInputElement).value).toBe("https://example.test/api");
});

it("composes HTTP, pod termination and latency and launches the generated job after Guardian", async () => {
 const created = vi.fn();
 render(<K6TestWizard open advancedMode={false} onClose={()=>{}} onCreated={created}/>);
 fireEvent.click(await screen.findByRole("button", { name: /Tests combinés/ }));
 await waitFor(()=>expect((screen.getByLabelText("Namespace") as HTMLSelectElement).value).toBe("qa"));
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
 fireEvent.click(screen.getByRole("button", { name: "Préconfiguration HTTP + chaos" }));
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
 expect(screen.getAllByRole("alert")[0].textContent).toContain("Vérifiez");
 fireEvent.change(screen.getByLabelText("URL cible"), { target: { value: "https://example.test/health" } });
 fireEvent.change(screen.getByLabelText("Valeur du label des pods"), { target: { value: "checkout" } });
 fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
 expect(screen.getByText(/Le chaos utilise un seul runner/)).toBeTruthy();
 for(let i=0;i<2;i++)fireEvent.click(screen.getByRole("button",{name:"Continuer"}));
 fireEvent.click(screen.getByRole("button",{name:"Confirmer"}));
 expect(apiMock.createCRD).not.toHaveBeenCalled();
 fireEvent.click(await screen.findByRole("button", { name: "Valider le lancement" }));
 await waitFor(()=>expect(created).toHaveBeenCalledOnce());
 const [cluster, namespace, payload] = apiMock.createCRD.mock.calls[0];
 expect([cluster,namespace,payload.resource_kind,payload.spec.parallelism]).toEqual(["c1","qa","job",1]);
 expect(payload.scriptContent).toContain('"network_latency":');
 expect(payload.scriptContent).toContain('"pod_kill":');
 expect(payload.scriptContent).toContain('"http":');
 expect(payload.scriptContent).toContain('"namespace":"qa","select":{"labels":{"app":"checkout"}}');
 expect(payload.validation_run_id).toBe("validation-test");
 expect(payload.spec.script.configMap.name).toBe(`cm-${payload.name}`);
 expect(payload.spec.runner.env).toContainEqual({name:"STRATOS_RUN_ID",valueFrom:{fieldRef:{fieldPath:"metadata.labels['job-name']"}}});
});
