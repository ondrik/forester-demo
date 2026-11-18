#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *left;
    struct node *right;
};

/* a stack of tree nodes, as a singly linked list */
struct item {
    struct item *next;
    struct node *node;
};

struct node *create(void)
{
    struct node *root = malloc(sizeof *root);
    root->left = NULL;
    root->right = NULL;

    while (__VERIFIER_nondet_int()) {
        struct node *n = root;
        while (n->left && n->right)
            n = __VERIFIER_nondet_int() ? n->left : n->right;

        struct node *leaf = malloc(sizeof *leaf);
        leaf->left = NULL;
        leaf->right = NULL;
        if (!n->left)
            n->left = leaf;
        else
            n->right = leaf;
    }
    return root;
}

struct item *push(struct item *stack, struct node *node)
{
    struct item *it = malloc(sizeof *it);
    it->next = stack;
    it->node = node;
    return it;
}

/* depth-first destruction with an explicit stack */
void destroy(struct node *root)
{
    struct item *stack = push(NULL, root);
    while (stack) {
        struct item *top = stack;
        struct node *n = top->node;
        stack = top->next;
        free(top);

        if (n->left)
            stack = push(stack, n->left);
        free(n);
        if (n->right)
            stack = push(stack, n->right);
    }
}

int main(void)
{
    destroy(create());
    return 0;
}
