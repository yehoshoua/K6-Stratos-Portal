import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { supplementalStrings } from '@/i18n/strings';
import ClustersPage from './page';

const apiMock = vi.hoisted(() => ({ getClusters:vi.fn(), getNamespaces:vi.fn(), getClusterAddons:vi.fn() }));
vi.mock('@/services/api', () => ({ api:apiMock }));
vi.mock('@/components/PreferencesContext', () => ({ usePreferences:() => ({lang:'en',t:(key:string) => (supplementalStrings.en as Record<string,string>)[key] || key}) }));
const currentAddon = {name:'coredns',current:'v1.2.3-eksbuild.1',recommended:'v1.2.3-eksbuild.1',status:'ACTIVE'};
beforeEach(() => {
 vi.clearAllMocks();
 apiMock.getClusters.mockResolvedValue([{id:'c1',name:'demo',api_server_url:'https://test.eks.amazonaws.com',auth_type:'local'}]);
 apiMock.getNamespaces.mockResolvedValue(['demo-udi']);
 apiMock.getClusterAddons.mockResolvedValue([currentAddon]);
});
afterEach(cleanup);

describe('cluster discovery', () => {
 it('shows discovered namespaces and only add-ons with version differences', async () => {
  apiMock.getClusterAddons.mockResolvedValue([currentAddon,{...currentAddon,name:'vpc-cni',recommended:'v1.2.4-eksbuild.1'}]);
  render(<ClustersPage />);
  expect(await screen.findByText('demo-udi')).toBeTruthy();
  expect(await screen.findByText('vpc-cni')).toBeTruthy();
  expect(screen.queryByText('coredns')).toBeNull();
  expect(screen.queryByText(supplementalStrings.en.allAddonsUpToDate)).toBeNull();
 });
 it('reports failures and clears stale success on retry', async () => {
  render(<ClustersPage />);
  expect(await screen.findByText(supplementalStrings.en.allAddonsUpToDate)).toBeTruthy();
  apiMock.getNamespaces.mockRejectedValue(new Error('forbidden'));
  apiMock.getClusterAddons.mockRejectedValue(new Error('denied'));
  fireEvent.click(screen.getByRole('button', {name:'testConn'}));
  expect(await screen.findByText(supplementalStrings.en.clusterNamespaceError)).toBeTruthy();
  expect(await screen.findByText(supplementalStrings.en.clusterAddonError)).toBeTruthy();
  await waitFor(() => expect(screen.getByText('fail')).toBeTruthy());
  expect(screen.queryByText('demo-udi')).toBeNull();
  expect(screen.queryByText(supplementalStrings.en.allAddonsUpToDate)).toBeNull();
  apiMock.getNamespaces.mockResolvedValue(['demo-udi']);
  apiMock.getClusterAddons.mockResolvedValue([currentAddon]);
  fireEvent.click(screen.getByRole('button', {name:'testConn'}));
  expect(await screen.findByText(supplementalStrings.en.allAddonsUpToDate)).toBeTruthy();
  expect(screen.queryByText(supplementalStrings.en.clusterAddonError)).toBeNull();
 });
 it('distinguishes an empty inventory from a successful version check', async () => {
  apiMock.getNamespaces.mockResolvedValue([]);
  apiMock.getClusterAddons.mockResolvedValue([]);
  render(<ClustersPage />);
  expect(await screen.findByText(supplementalStrings.en.clusterNoNamespaces)).toBeTruthy();
  expect(await screen.findByText(supplementalStrings.en.clusterNoAddons)).toBeTruthy();
  expect(screen.queryByText(supplementalStrings.en.allAddonsUpToDate)).toBeNull();
 });
 it('does not present an unhealthy add-on as up to date', async () => {
  apiMock.getClusterAddons.mockResolvedValue([{...currentAddon,status:'DEGRADED'}]);
  render(<ClustersPage />);
  expect(await screen.findByText(supplementalStrings.en.clusterAddonNotActive)).toBeTruthy();
  expect(screen.queryByText(supplementalStrings.en.allAddonsUpToDate)).toBeNull();
 });
});
