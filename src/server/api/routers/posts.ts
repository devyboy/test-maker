import clerkClient, { type User } from "@clerk/clerk-sdk-node";
import type { Post } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, privateProcedure, publicProcedure } from "~/server/api/trpc";

const createPostValidator = z.object({ content: z.string().min(1).max(200) })

const filterUserForClient = (user: User) => {
    return {
        id: user.id,
        username: user.username,
        externalUsername: user.emailAddresses[0]?.emailAddress || user.id,
        profileImageUrl: user.profileImageUrl,
        firstName: user.firstName
    }
}

const addUserDataToPosts = async (posts: Post[]) => {
    const userId = posts.map((post) => post.authorId);
    const users = (
        await clerkClient.users.getUserList({
            userId: userId,
        })
    ).map(filterUserForClient);

    return posts.map((post) => {

        const author = users.find((user) => user.id === post.authorId);

        if (!author) {
            console.error("AUTHOR NOT FOUND", post);
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Author for post not found. POST ID: ${post.id}, USER ID: ${post.authorId}`,
            });
        }

        if (!author.username) {
            if (!author.externalUsername) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Author has no Gmail Account: ${author.id}`,
                });
            }
            author.username = author.externalUsername;
        }
        return {
            post,
            author: {
                ...author,
                username: author.username ?? "(username not found)",
            },
        };
    });
};


export const postsRouter = createTRPCRouter({
    getAll: publicProcedure.query(async ({ ctx }) => {
        const posts = await ctx.prisma.post.findMany()
        return addUserDataToPosts(posts)
    }),

    getPostById: publicProcedure.input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const post = await ctx.prisma.post.findUnique({
                where: { id: input.id },
            });

            if (!post) throw new TRPCError({ code: "NOT_FOUND" });

            return (await addUserDataToPosts([post]))[0]
        }),

    createPost: privateProcedure.input(createPostValidator).mutation(async ({ ctx, input }) => {
        const authorId = ctx.userId

        const post = await ctx.prisma.post.create({
            data: {
                content: input.content,
                authorId,
            }
        })

        return post
    })
});
