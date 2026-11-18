#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *left;
    struct node *right;
};

/* a binary tree of unknown shape and size */
struct node *create(void)
{
    struct node *root = malloc(sizeof *root);
    root->left = NULL;
    root->right = NULL;

    while (__VERIFIER_nondet_int()) {
        /* walk down to a node with a free slot */
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

/* remove leaves one by one, without recursion and without a stack */
void destroy(struct node *root)
{
    while (root) {
        struct node *parent = NULL, *n = root;
        while (n->left || n->right) {
            parent = n;
            n = n->left ? n->left : n->right;
        }
        if (!parent)
            root = NULL;
        else if (parent->left == n)
            parent->left = NULL;
        else
            parent->right = NULL;
        free(n);
    }
}

int main(void)
{
    destroy(create());
    return 0;
}
