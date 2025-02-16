// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useFeatureValue } from '@growthbook/growthbook-react';
import {
	KioskTypes,
	ORIGINBYTE_KIOSK_OWNER_TOKEN,
	getKioskIdFromOwnerCap,
	useGetKioskContents,
	useGetObject,
} from '@mysten/core';
import { useSuiClient } from '@mysten/dapp-kit';
import { take } from '@mysten/kiosk';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { useMutation } from '@tanstack/react-query';
import { useActiveAccount } from '_src/ui/app/hooks/useActiveAccount';
import { useSigner } from '_src/ui/app/hooks/useSigner';

const ORIGINBYTE_PACKAGE_ID = '0x083b02db943238dcea0ff0938a54a17d7575f5b48034506446e501e963391480';

export function useTransferKioskItem({
	objectId,
	objectType,
}: {
	objectId: string;
	objectType?: string | null;
}) {
	const client = useSuiClient();
	const activeAccount = useActiveAccount();
	const signer = useSigner(activeAccount);
	const address = activeAccount?.address;

	const obPackageId = useFeatureValue('kiosk-originbyte-packageid', ORIGINBYTE_PACKAGE_ID);
	const { data: kioskData } = useGetKioskContents(address);

	const objectData = useGetObject(objectId);

	return useMutation({
		mutationFn: async ({ to, clientIdentifier }: { to: string; clientIdentifier?: string }) => {
			if (!to || !signer || !objectType) {
				throw new Error('Missing data');
			}

			const kioskId = kioskData?.lookup.get(objectId);
			const kiosk = kioskData?.kiosks.get(kioskId!);

			if (!kioskId || !kiosk) {
				throw new Error('Failed to find object in a kiosk');
			}

			if (kiosk.type === KioskTypes.SUI && objectData?.data?.data?.type && kiosk?.ownerCap) {
				const tx = new TransactionBlock();
				// take item out of kiosk
				const obj = take(tx, objectData.data?.data?.type, kioskId, kiosk?.ownerCap, objectId);
				// transfer as usual
				tx.transferObjects([obj], tx.pure(to));
				return signer.signAndExecuteTransactionBlock(
					{
						transactionBlock: tx,
						options: {
							showInput: true,
							showEffects: true,
							showEvents: true,
						},
					},
					clientIdentifier,
				);
			}

			if (kiosk.type === KioskTypes.ORIGINBYTE && objectData?.data?.data?.type) {
				const tx = new TransactionBlock();
				const recipientKiosks = await client.getOwnedObjects({
					owner: to,
					options: { showContent: true },
					filter: { StructType: ORIGINBYTE_KIOSK_OWNER_TOKEN },
				});
				const recipientKiosk = recipientKiosks.data[0];
				const recipientKioskId = recipientKiosk ? getKioskIdFromOwnerCap(recipientKiosk) : null;

				if (recipientKioskId) {
					tx.moveCall({
						target: `${obPackageId}::ob_kiosk::p2p_transfer`,
						typeArguments: [objectType],
						arguments: [tx.object(kioskId), tx.object(recipientKioskId), tx.pure(objectId)],
					});
				} else {
					tx.moveCall({
						target: `${obPackageId}::ob_kiosk::p2p_transfer_and_create_target_kiosk`,
						typeArguments: [objectType],
						arguments: [tx.object(kioskId), tx.pure(to), tx.pure(objectId)],
					});
				}
				return signer.signAndExecuteTransactionBlock(
					{
						transactionBlock: tx,
						options: {
							showInput: true,
							showEffects: true,
							showEvents: true,
						},
					},
					clientIdentifier,
				);
			}
			throw new Error('Failed to transfer object');
		},
	});
}
